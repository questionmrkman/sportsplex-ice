// Parsers for each data source. Every parser returns normalized slots:
// { id, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM'|null, endEstimated, pad:1-4|null,
//   source, org, kind, title, team, opponent, detail, price, spots, url }
import * as cheerio from 'cheerio';

export const UA =
  'Mozilla/5.0 (compatible; SportsplexIceTracker/1.0; personal schedule viewer)';

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad2 = (n) => String(n).padStart(2, '0');

/** "4:40 PM" -> "16:40" */
export function to24h(text) {
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(text || '');
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${pad2(h)}:${m[2]}`;
}

export function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 24 * 60 - 1);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** True when a venue string refers to Susan Fennell Sportsplex. */
export function isFennell(location) {
  // "South Fletcher's" is the former name of Susan Fennell Sportsplex (some leagues still use it).
  return /fennell|south\s+fletcher|\bSF\b/i.test(location || '');
}

/** "Susan Fennell (Pad 2)", "... - Rink 4", "SF Arena Ice (1)" -> pad number */
export function padFrom(location) {
  const m =
    /(?:pad|rink)\s*(\d)/i.exec(location || '') ||
    /Arena Ice\s*\(\s*(\d)\s*\)/i.exec(location || '');
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Team-site calendars (creditrivercapitals.ca, bramptonhockey.com, ...)
// ---------------------------------------------------------------------------

/** day-details id looks like "day-Oct-26-2026" */
function parseDayId(id) {
  const m = /^day-([A-Za-z]{3})-(\d{1,2})-(\d{4})$/.exec(id || '');
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return `${m[3]}-${pad2(month)}-${pad2(m[2])}`;
}

function classifyTeamEvent(tags, subject) {
  const t = tags.join(' ').toLowerCase();
  if (/unused/i.test(subject)) return 'unused';
  if (t.includes('game')) return 'game';
  if (t.includes('practice')) return 'practice';
  return 'event';
}

export function parseTeamCalendar(html, site) {
  const $ = cheerio.load(html);
  const slots = [];

  $('.day-details').each((_, day) => {
    const date = parseDayId($(day).attr('id'));
    if (!date) return;

    $(day)
      .find('.event-list-item')
      .each((__, item) => {
        const $i = $(item);
        const location = $i.find('.location').first().text().trim();
        if (!isFennell(location)) return;

        const start = to24h($i.find('.time-primary').first().text());
        if (!start) return;
        const endRaw = to24h($i.find('.time-secondary').first().text());
        const tags = $i
          .find('.tag')
          .map((___, t) => $(t).text().trim())
          .get();
        const team = $i.find('.subject-owner').first().text().trim();
        const subject = $i.find('.subject-text').first().clone().children().remove().end().text().trim();
        const kind = classifyTeamEvent(tags, `${team} ${subject}`);
        const gameLink = $i.find('a[href*="/Games/"]').first().attr('href');
        const gameNo = $i.find('.game_no').first().text().trim();

        const isGame = kind === 'game';
        const end = endRaw || (isGame ? addMinutes(start, 90) : null);

        slots.push({
          date,
          start,
          end,
          endEstimated: !endRaw,
          pad: padFrom(location),
          source: site.id,
          org: site.name,
          kind,
          title: isGame ? subject : kind === 'unused' ? 'Unused ice' : subject || tags.join(', '),
          team: kind === 'unused' ? null : team || null,
          opponent: isGame ? subject.replace(/^(vs\.?|@)\s*/i, '') : null,
          detail: [gameNo, tags.join(' · ')].filter(Boolean).join(' · ') || null,
          price: null,
          spots: null,
          url: gameLink ? new URL(gameLink, site.url).href : site.url,
        });
      });
  });

  return slots;
}

// ---------------------------------------------------------------------------
// City of Brampton public programs (PerfectMind widget JSON)
// ---------------------------------------------------------------------------

export function classifyPublic(name) {
  const n = name.toLowerCase();
  if (n.includes('shinny')) return 'shinny';
  if (n.includes('figure')) return 'figure';
  if (n.includes('stick')) return 'stick';
  if (n.includes('skate')) return 'public';
  return 'program';
}

export function parsePerfectMindClass(c, site) {
  const location = `${c.Location || ''} ${c.Facility || ''} ${c.EventName || ''}`;
  if (!isFennell(c.Location) && !isFennell(c.Facility) && !/Susan Fennell/i.test(c.EventName)) {
    return null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(c.OccurrenceDate || '');
  if (!m) return null;
  const start = to24h(c.FormattedStartTime);
  const end = to24h(c.FormattedEndTime);
  if (!start) return null;

  const title = (c.EventName || '').split('|')[0].trim();
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    start,
    end,
    endEstimated: !end,
    pad: padFrom(c.Facility) ?? padFrom(location),
    source: site.id,
    org: site.name,
    kind: classifyPublic(title),
    title,
    team: null,
    opponent: null,
    detail: (c.Spots || '').trim() || null,
    price: (c.PriceRange || '').trim() || null,
    spots: (c.Spots || '').trim() || null,
    url: site.url,
  };
}

// ---------------------------------------------------------------------------
// Tournament schedules (silverstick.org): one page per tournament day
// ---------------------------------------------------------------------------

const TOURNAMENT_GAME_MINUTES = 70; // games start every 70-80 min; end times aren't published

/** The date a tournament day page is showing ("Nov 20, 2026" heading) -> YYYY-MM-DD */
export function tournamentDate(html) {
  const $ = cheerio.load(html);
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec($('.heading-1 .text').first().text());
  const month = m && MONTHS[m[1].toLowerCase()];
  return month ? `${m[3]}-${pad2(month)}-${pad2(m[2])}` : null;
}

/** Links to the other days listed in the page's day picker. */
export function tournamentDayLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href*="/Schedule/?Day="]').each((_, a) => links.add(new URL($(a).attr('href'), baseUrl).href));
  return [...links];
}

export function parseTournamentDay(html, site) {
  const $ = cheerio.load(html);
  const date = tournamentDate(html);
  if (!date) return [];
  const slots = [];

  $('.event-list-item').each((_, item) => {
    const $i = $(item);
    const location = $i.find('.location').first().text().trim();
    if (!isFennell(location)) return;
    const start = to24h($i.find('.time-primary').first().text());
    if (!start) return;

    const division = $i.find('.subject-group').first().text().trim();
    const home = $i.find('.subject-owner').first().text().trim();
    const awayEl = $i.find('.subject-text').first().clone();
    const gameNo = awayEl.find('.game_no').text().trim();
    awayEl.find('.game_no').remove();
    const away = awayEl.text().trim().replace(/^@\s*/, '');
    const pool = $i
      .find('.tag')
      .map((__, t) => $(t).text().trim())
      .get()
      .filter((t) => t && t !== division)
      .join(' ');
    const score = $i.find('.game_score').first().text().trim();
    const gameLink = $i.find('a[href*="/Games/"]').first().attr('href');

    slots.push({
      date,
      start,
      end: addMinutes(start, TOURNAMENT_GAME_MINUTES),
      endEstimated: true,
      pad: padFrom(location),
      source: site.id,
      org: site.name,
      kind: 'tournament',
      title: away ? `${home} @ ${away}` : home,
      team: null,
      opponent: null,
      detail: [division, pool, gameNo, score && `Score ${score}`].filter(Boolean).join(' · ') || null,
      price: null,
      spots: null,
      url: gameLink ? new URL(gameLink, site.url).href : site.url,
    });
  });

  return slots;
}

// ---------------------------------------------------------------------------
// City of Brampton Learn to Skate courses (PerfectMind "courses" JSON)
// ---------------------------------------------------------------------------

const toronto = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "/Date(1790370300000)/" (a real instant) -> { date:'YYYY-MM-DD', time:'HH:MM' } in Toronto time */
export function torontoParts(msDate) {
  const ms = Number(/-?\d+/.exec(msDate || '')?.[0]);
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(toronto.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** One slot per dated session of a course held at Susan Fennell. */
export function parsePerfectMindCourse(c, site, calendar) {
  if (!isFennell(c.Location) && !isFennell(c.Facility)) return [];
  const title = (c.EventName || '').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();
  const closed = /closed/i.test(c.BookButtonText || '');
  const status = closed ? 'Registration closed' : (c.BookButtonText || '').replace(/!$/, '').trim();
  const sessions = c.Occurrences || [];
  const total = c.NumberOfSessions || sessions.length;

  return sessions.flatMap((o, i) => {
    const start = torontoParts(o.StartDateWithOffset);
    const end = torontoParts(o.EndDateWithOffset);
    if (!start) return [];
    return [{
      date: start.date,
      start: start.time,
      end: end && end.date === start.date ? end.time : null,
      endEstimated: !(end && end.date === start.date),
      pad: padFrom(c.Facility) ?? padFrom(c.Location),
      source: site.id,
      org: site.name,
      kind: 'lesson',
      title,
      team: null,
      opponent: null,
      detail: [`Session ${(o.OccurrenceOrderNumber ?? i) + 1} of ${total}`, status].filter(Boolean).join(' · '),
      price: null, // fees intentionally not shown for lessons
      spots: (c.Spots || '').trim() || null,
      url: calendar.url,
      uid: c.EventId,
    }];
  });
}

// ---------------------------------------------------------------------------
// HockeyLeagueStats league schedules (e.g. McLaughlin Meds Hockey League)
// ---------------------------------------------------------------------------

const HLS_DEFAULT_GAME_MINUTES = 70; // end times aren't published; a source can override with `gameMinutes`

/**
 * Rows: Num | "Sun-Sep 20" | "8:00 am" | Location | Home | H score | V score | Visitor.
 * Dates carry no year, so it comes from the "Schedule : 2026 / 2027 ..." heading
 * (Sep-Dec belong to the first year, Jan-Aug to the second).
 */
export function parseHockeyLeagueStats(html, site) {
  const $ = cheerio.load(html);
  // "2026 / 2027" or "2026/27"
  const heading = /Schedule\s*:[^0-9]*(\d{4})\s*\/\s*(\d{2,4})/.exec($.root().text().replace(/\s+/g, ' '));
  if (!heading) throw new Error('HockeyLeagueStats: could not find the season in the schedule heading');
  const startYear = Number(heading[1]);
  const endYear = heading[2].length === 2 ? Math.floor(startYear / 100) * 100 + Number(heading[2]) : Number(heading[2]);

  const slots = [];
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length !== 8) return;
    const [num, dateText, timeText, location, home, homeScore, visitorScore, visitor] = cells;
    const d = /^[A-Za-z]{3}-([A-Za-z]{3})\s+(\d{1,2})$/.exec(dateText);
    const month = d && MONTHS[d[1].toLowerCase()];
    const start = to24h(timeText);
    if (!month || !start || !isFennell(location)) return;

    const year = month >= 9 ? startYear : endYear;
    const played = /^\d+$/.test(homeScore) && /^\d+$/.test(visitorScore);
    const link = $(tr).find('a[href*="showgame"]').first().attr('href');

    slots.push({
      date: `${year}-${pad2(month)}-${pad2(d[2])}`,
      start,
      end: addMinutes(start, site.gameMinutes ?? HLS_DEFAULT_GAME_MINUTES),
      endEstimated: true,
      pad: padFrom(location),
      source: site.id,
      org: site.name,
      kind: 'game',
      title: `${home} vs ${visitor}`,
      team: null,
      opponent: null,
      detail: [`Game ${num}`, played && `Final ${homeScore}–${visitorScore}`].filter(Boolean).join(' · '),
      price: null,
      spots: null,
      url: link ? new URL(link, site.url).href : site.url,
      uid: `${site.id}-${num}`,
    });
  });
  return slots;
}
