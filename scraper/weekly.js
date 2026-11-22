// Leagues that skate the same time every week but publish no calendar of their own: the organizer gives us the
// weekday, pad, time blocks and the season's first/last date, and every week in between becomes slots.
// Configured in SOURCES (scraper/scrape.js) with type 'weekly'.

const DAY = 86_400_000;
const parse = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param site {id, name, weekday (0 = Sunday), pad, from, until (inclusive YYYY-MM-DD), sessions: [{start, end}], skip?: [dates]}
 */
export function weeklySlots(site) {
  const { id, name, weekday, pad, from, until, sessions, skip = [] } = site;
  if (new Date(parse(from)).getUTCDay() !== weekday) throw new Error(`${name}: ${from} is not weekday ${weekday}`);
  if (parse(until) < parse(from)) throw new Error(`${name}: season ends before it starts`);
  const out = [];
  for (let t = parse(from); t <= parse(until); t += 7 * DAY) {
    const date = fmt(t);
    if (skip.includes(date)) continue;
    sessions.forEach((s, i) => {
      out.push({
        date,
        start: s.start,
        end: s.end,
        endEstimated: false,
        pad,
        source: id,
        org: name,
        kind: 'league',
        title: name,
        team: null,
        opponent: null,
        detail: sessions.length > 1 ? `Weekly league · session ${i + 1} of ${sessions.length}` : 'Weekly league',
        price: null,
        spots: null,
        url: null,
      });
    });
  }
  return out;
}
