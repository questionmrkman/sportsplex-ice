// Scrapes all sources and writes site/data/schedule.json.
// Usage: node scraper/scrape.js [--months=8] [--days=75]
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import {
  UA, parseTeamCalendar, parsePerfectMindClass, parseTournamentDay, tournamentDate, tournamentDayLinks,
} from './sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = path.join(ROOT, 'site', 'data', 'schedule.json');

export const SOURCES = [
  { id: 'capitals', name: 'Credit River Capitals', type: 'team', url: 'https://creditrivercapitals.ca/Calendar/' },
  { id: 'bhl', name: 'Brampton Hockey', type: 'team', url: 'https://bramptonhockey.com/Calendar/' },
  { id: 'canadettes', name: 'Brampton Canadettes', type: 'team', url: 'https://bramptoncanadettes.com/Calendar/' },
  { id: 'silverstick', name: 'Silver Stick Tournament', type: 'tournament', url: 'https://silverstick.org/Tournaments/31575/Schedule/' },
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
];

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

async function scrapePerfectMind(site, { days }) {
  const page = await getText(site.url);
  const cookies = (page.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const html = await page.text();
  const token = cheerio.load(html)('input[name="__RequestVerificationToken"]').first().attr('value');
  if (!token) throw new Error('PerfectMind: anti-forgery token not found');

  const endpoint = `${site.base}/${site.tenant}/Clients/BookMe4BookingPagesV2/ClassesV2`;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);

  const slots = [];
  // The widget pages forward with `after` (the previous response's nextKey);
  // each response covers about three days of programs.
  let after = null;
  const seenKeys = new Set();

  for (let i = 0; i < 60; i++) {
    const params = {
      __RequestVerificationToken: token,
      calendarId: site.calendarId,
      widgetId: site.widgetId,
      page: '0',
    };
    if (after) params.after = after;
    const res = await getText(endpoint, {
      method: 'POST',
      body: new URLSearchParams(params),
      headers: {
        Cookie: cookies,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: site.url,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
    });
    const json = await res.json();
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

// -- orchestration ----------------------------------------------------------

function finalize(slots) {
  const seen = new Set();
  const out = [];
  for (const s of slots) {
    const key = [s.source, s.date, s.start, s.end, s.pad, s.team, s.title, s.opponent].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: createHash('sha1').update(key).digest('hex').slice(0, 10), ...s });
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
