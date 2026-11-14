// Scrapes all sources and writes site/data/schedule.json.
// Usage: node scraper/scrape.js [--months=8] [--days=75]
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import {
  UA, parseTeamCalendar, parsePerfectMindClass, parsePerfectMindCourse, parseHockeyLeagueStats, parseIcohl, parseTournamentDay, tournamentDate, tournamentDayLinks,
} from './sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = path.join(ROOT, 'site', 'data', 'schedule.json');

const PM_BASE = 'https://cityofbrampton.perfectmind.com';

export const SOURCES = [
  { id: 'capitals', name: 'Credit River Capitals', type: 'team', url: 'https://creditrivercapitals.ca/Calendar/' },
  { id: 'bhl', name: 'Brampton Hockey', type: 'team', url: 'https://bramptonhockey.com/Calendar/' },
  { id: 'canadettes', name: 'Brampton Canadettes', type: 'team', url: 'https://bramptoncanadettes.com/Calendar/' },
  { id: 'silverstick', name: 'Silver Stick Tournament', type: 'tournament', url: 'https://silverstick.org/Tournaments/31575/Schedule/' },
  // HockeyLeagueStats leagues. gameMinutes is the drawn length (end times aren't published); games start every 80 / 60 min.
  { id: 'mmeds', name: 'McLaughlin Meds Hockey League', type: 'hls', gameMinutes: 70, url: 'https://www.mclaughlinmedshockey.hockeyleaguestats.com/?go=schedule&did=14&sid=61' },
  { id: 'icohl', name: 'ICOHL', type: 'icohl', gameMinutes: 60, url: 'https://icohl.com/202627/schedule.html' },
  { id: 'tgif', name: "TGIF Men's Hockey", type: 'hls', gameMinutes: 60, url: 'https://www.hockeyleaguestats.com/tgif/?go=schedule&did=13&sid=48' },
  {
    id: 'city',
    name: 'City of Brampton (Public)',
    type: 'perfectmind',
    url: 'https://cityofbrampton.perfectmind.com/23782/Clients/BookMe4BookingPages/Classes?widgetId=15f6af07-39c5-473e-b053-96653f77a406&calendarId=66a6c983-2ead-42a9-8445-d926fa974fbf&singleCalendarWidget=False',
    base: 'https://cityofbrampton.perfectmind.com',
    tenant: '23782',
    widgetId: '15f6af07-39c5-473e-b053-96653f77a406',
    calendarId: '66a6c983-2ead-42a9-8445-d926fa974fbf',
  },
  {
    id: 'lessons',
    name: 'City Learn to Skate',
    type: 'perfectmind-courses',
    base: PM_BASE,
    tenant: '23782',
    widgetId: '15f6af07-39c5-473e-b053-96653f77a406',
    calendars: [
      { id: '5b23c80e-5005-446d-aaa1-7c81d2cf6cbb', label: '3 to 6 Years', url: `${PM_BASE}/23782/Clients/BookMe4BookingPages/BookingCoursesPage?calendarId=5b23c80e-5005-446d-aaa1-7c81d2cf6cbb&widgetId=15f6af07-39c5-473e-b053-96653f77a406&embed=False` },
      { id: '672b6b90-a343-4916-b721-94f390d49fcd', label: '6 to 14 Years', url: `${PM_BASE}/23782/Clients/BookMe4BookingPages/BookingCoursesPage?calendarId=672b6b90-a343-4916-b721-94f390d49fcd&widgetId=15f6af07-39c5-473e-b053-96653f77a406&embed=False` },
      { id: '9acc0595-3619-4432-81d5-daa523423e43', label: '14+ Years', url: `${PM_BASE}/23782/Clients/BookMe4BookingPages/BookingCoursesPage?calendarId=9acc0595-3619-4432-81d5-daa523423e43&widgetId=15f6af07-39c5-473e-b053-96653f77a406&embed=False` },
      { id: '0ab264f6-5ca7-4bb1-ab92-830bd6b619d7', label: 'Private Lessons', url: `${PM_BASE}/23782/Clients/BookMe4BookingPages/BookingCoursesPage?calendarId=0ab264f6-5ca7-4bb1-ab92-830bd6b619d7&widgetId=15f6af07-39c5-473e-b053-96653f77a406&embed=False` },
    ],
  },
];
// Footer link for sources that span several pages.
for (const s of SOURCES) s.url ??= s.calendars?.[0]?.url;

async function getText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// -- team calendars ---------------------------------------------------------

function monthsFrom(start, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return out;
}

async function scrapeTeamSite(site, { months }) {
  const slots = [];
  let lastMonth = null;
  let note = null;
  for (const { month, year } of monthsFrom(new Date(), months)) {
    // Don't follow redirects: far-out months are redirected to a bot-check
    // ("/Human/") page. We stop there rather than trying to get past it.
    const res = await fetch(`${site.url}?Month=${month}&Year=${year}`, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status >= 300 && res.status < 400) {
      note = `Site publishes no further than ${lastMonth ?? 'this month'}`;
      break;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${site.url}`);
    slots.push(...parseTeamCalendar(await res.text(), site));
    lastMonth = `${year}-${String(month).padStart(2, '0')}`;
  }
  if (!lastMonth) throw new Error('No calendar months could be fetched');
  return { slots, note };
}

// -- tournament (one page per day) -----------------------------------------

async function scrapeTournament(site) {
  const html = await (await getText(site.url)).text();
  const slots = parseTournamentDay(html, site);
  const seenDates = new Set([tournamentDate(html)]);
  // Days outside the tournament clamp to its first/last day, so track the dates we actually got.
  for (const link of tournamentDayLinks(html, site.url)) {
    const dayHtml = await (await getText(link)).text();
    const date = tournamentDate(dayHtml);
    if (!date || seenDates.has(date)) continue;
    seenDates.add(date);
    slots.push(...parseTournamentDay(dayHtml, site));
  }
  return slots;
}

// -- PerfectMind ------------------------------------------------------------

/** Loads a booking page and returns the cookies + anti-forgery token its JSON endpoints need. */
async function pmSession(pageUrl) {
  const page = await getText(pageUrl);
  const cookies = (page.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const token = cheerio.load(await page.text())('input[name="__RequestVerificationToken"]').first().attr('value');
  if (!token) throw new Error('PerfectMind: anti-forgery token not found');
  return { cookies, token, pageUrl };
}

async function pmPost(endpoint, session, params) {
  const res = await getText(endpoint, {
    method: 'POST',
    body: new URLSearchParams({ __RequestVerificationToken: session.token, ...params }),
    headers: {
      Cookie: session.cookies,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: session.pageUrl,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
  });
  return res.json();
}

async function scrapePerfectMind(site, { days }) {
  const session = await pmSession(site.url);
  const endpoint = `${site.base}/${site.tenant}/Clients/BookMe4BookingPagesV2/ClassesV2`;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);

  const slots = [];
  // The widget pages forward with `after` (the previous response's nextKey);
  // each response covers about three days of programs.
  let after = null;
  const seenKeys = new Set();

  for (let i = 0; i < 60; i++) {
    const params = { calendarId: site.calendarId, widgetId: site.widgetId, page: '0' };
    if (after) params.after = after;
    const json = await pmPost(endpoint, session, params);
    const classes = json.classes || [];
    for (const c of classes) {
      const slot = parsePerfectMindClass(c, site);
      if (slot) slots.push(slot);
    }
    const next = json.nextKey;
    if (!next || seenKeys.has(next) || !classes.length) break;
    seenKeys.add(next);
    if (new Date(`${next}T00:00:00`) > limit) break;
    after = next;
  }
  return slots;
}

// -- HockeyLeagueStats (single schedule page) --------------------------------

async function scrapeHls(site) {
  // This server answers 406 unless the request carries a normal Accept header.
  const res = await getText(site.url, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-CA,en;q=0.8' },
  });
  // The page is served as ISO-8859-1.
  const html = new TextDecoder('windows-1252').decode(await res.arrayBuffer());
  return parseHockeyLeagueStats(html, site);
}

// -- ICOHL (single static schedule page) --------------------------------------

async function scrapeIcohl(site) {
  const res = await getText(site.url, { headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' } });
  return parseIcohl(await res.text(), site);
}

// -- PerfectMind courses (Learn to Skate series) ----------------------------

async function scrapeLessons(site) {
  const endpoint = `${site.base}/${site.tenant}/Clients/BookMe4BookingPagesV2/CoursesV2`;
  const slots = [];
  const seenCourses = new Set();
  for (const cal of site.calendars) {
    const session = await pmSession(cal.url);
    let after = null;
    // One response normally holds every course; follow `nextKey` in case it ever pages.
    for (let i = 0; i < 10; i++) {
      const params = { calendarId: cal.id, widgetId: site.widgetId, page: '0', bookingMode: '0' };
      if (after) params.after = after;
      const json = await pmPost(endpoint, session, params);
      const courses = json.courses || [];
      for (const c of courses) {
        if (seenCourses.has(c.EventId)) continue;
        seenCourses.add(c.EventId);
        slots.push(...parsePerfectMindCourse(c, site, cal));
      }
      if (!courses.length || !json.nextKey || json.nextKey === after) break;
      after = json.nextKey;
    }
  }
  return slots;
}

// -- orchestration ----------------------------------------------------------

function finalize(slots) {
  const seen = new Set();
  const out = [];
  for (const s of slots) {
    const { uid, ...slot } = s; // uid only keeps same-looking sessions of different courses apart
    const key = [s.source, s.date, s.start, s.end, s.pad, s.team, s.title, s.opponent, uid].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: createHash('sha1').update(key).digest('hex').slice(0, 10), ...slot });
  }
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      (a.pad ?? 9) - (b.pad ?? 9),
  );
  return out;
}

export async function runScrape({ months = 8, days = 75, write = true } = {}) {
  const status = [];
  const all = [];

  await Promise.all(
    SOURCES.map(async (site) => {
      const t0 = Date.now();
      try {
        const { slots, note } =
          site.type === 'team'
            ? await scrapeTeamSite(site, { months })
            : site.type === 'tournament'
              ? { slots: await scrapeTournament(site), note: null }
              : site.type === 'icohl'
                ? { slots: await scrapeIcohl(site), note: null }
              : site.type === 'hls'
                ? { slots: await scrapeHls(site), note: null }
                : site.type === 'perfectmind-courses'
                  ? { slots: await scrapeLessons(site), note: null }
                  : { slots: await scrapePerfectMind(site, { days }), note: null };
        all.push(...slots);
        status.push({ id: site.id, name: site.name, url: site.url, ok: true, count: slots.length, note, ms: Date.now() - t0 });
      } catch (err) {
        status.push({ id: site.id, name: site.name, url: site.url, ok: false, error: String(err.message || err), count: 0 });
      }
    }),
  );

  const result = {
    facility: 'Susan Fennell Sportsplex',
    address: '1 Cityview Cir, Brampton, ON',
    timezone: 'America/Toronto',
    generatedAt: new Date().toISOString(),
    sources: SOURCES.map((s) => status.find((x) => x.id === s.id)),
    slots: finalize(all),
  };

  if (write) {
    await mkdir(path.dirname(OUT_FILE), { recursive: true });
    // Never clobber good data with an empty scrape (e.g. offline).
    if (result.slots.length > 0) await writeFile(OUT_FILE, JSON.stringify(result));
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def);
  const r = await runScrape({ months: arg('months', 8), days: arg('days', 75) });
  for (const s of r.sources) console.log(s.ok ? 'OK  ' : 'FAIL', s.name.padEnd(28), s.ok ? `${s.count} slots` : s.error);
  console.log(`Total: ${r.slots.length} slots -> ${OUT_FILE}`);
  if (r.sources.some((s) => !s.ok)) process.exitCode = 1;
}
