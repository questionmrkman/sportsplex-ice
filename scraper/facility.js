// The facility's own printed schedule ("Facility Schedule") is the source of truth for ice times.
// It's transcribed by hand into scraper/data/facility-schedule.json (add rows from new photos there).
//
// Rule: when a row belongs to a group whose own source already lists something at that pad and time,
// the existing slots win and the facility row is dropped (keeps the format already pulled from the other
// sites). Everything else on the sheet is added, so nothing the facility has booked is missing.

/** Which existing source a facility row belongs to, judged by its event/service text. */
export const GROUPS = [
  { test: (e) => /\bCRC\b/.test(e.event), source: 'capitals' }, // Credit River Capitals
  { test: (e) => /\bBHI\b/.test(e.event), source: 'bhl' }, // Brampton Hockey
  { test: (e) => /Canadettes/i.test(e.event), source: 'canadettes' },
  { test: (e) => /Inner City Oldtimers/i.test(e.event), source: 'icohl' },
  { test: (e) => /Drop-In/i.test(e.service), source: 'city' }, // shinny + public skate
  { test: (e) => /^Skating/i.test(e.event), source: 'lessons' }, // Learn to Skate
];

const mins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const overlaps = (a, b) => mins(a.start) < mins(b.end ?? b.start) + (b.end ? 0 : 60) && mins(b.start) < mins(a.end);

export function groupSource(entry) {
  return GROUPS.find((g) => g.test(entry))?.source ?? null;
}

export function kindFor(entry) {
  if (/Maintenance/i.test(entry.service) || /Maintenance/i.test(entry.event)) return 'maintenance';
  if (/^Internal/i.test(entry.service)) return 'hold';
  if (/Shinny/i.test(entry.service)) return 'shinny';
  if (/Public Skate/i.test(entry.service)) return 'public';
  if (/^Skating/i.test(entry.event)) return 'lesson';
  return 'booking';
}

/** "2026/27 F/W Youth Hockey Development Program (Coach Phil)" -> "Youth Hockey Development Program (Coach Phil)" */
export function titleFor(entry) {
  if (kindFor(entry) === 'maintenance') return 'Ice maintenance';
  return entry.event
    .split('|')[0]
    .replace(/^\d{4}[-/]\d{2}\s+(?:F\/W|FW)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DETAIL = {
  maintenance: 'Weekly ice maintenance (internal hold)',
  hold: 'Internal program/admin hold',
  booking: 'Booked on the facility schedule',
};

/**
 * @param entries  rows from facility-schedule.json
 * @param others   slots already scraped from the other sources
 * @returns        slots to add (rows not already covered by their own group's source)
 */
export function facilitySlots(entries, others, site) {
  const out = [];
  for (const e of entries) {
    const source = groupSource(e);
    if (source) {
      const covered = others.some((s) => s.source === source && s.date === e.date && s.pad === e.pad && overlaps(e, s));
      if (covered) continue; // duplicate: keep the existing slot
    }
    const kind = kindFor(e);
    out.push({
      date: e.date,
      start: e.start,
      end: e.end,
      endEstimated: false,
      pad: e.pad,
      source: site.id,
      org: site.name,
      kind,
      title: titleFor(e),
      team: null,
      opponent: null,
      detail: DETAIL[kind] ?? null,
      price: null,
      spots: null,
      url: null,
      uid: `${e.pad}|${e.date}|${e.start}|${e.event}`,
    });
  }
  return out;
}
