// Fennell Ice Schedule — static front end. Reads data/schedule.json.
const TZ = 'America/Toronto';
const HOUR_PX = 60;
const PADS = [1, 2, 3, 4];

const KINDS = {
  game: 'Games',
  tournament: 'Tournament',
  practice: 'Practices',
  lesson: 'Lessons',
  public: 'Public skate',
  shinny: 'Shinny',
  figure: 'Figure skating',
  stick: 'Stick & puck',
  program: 'Other programs',
  event: 'Events',
  unused: 'Unused ice',
};
const KIND_VAR = (k) => `var(--${k}-fg)`;
const KIND_SINGULAR = {
  game: 'Game', tournament: 'Tournament game', practice: 'Practice', lesson: 'Skating lesson', public: 'Public skate', shinny: 'Shinny', figure: 'Figure skating',
  stick: 'Stick & puck', program: 'Program', event: 'Event', unused: 'Unused ice',
};
const SHORT = { capitals: 'Capitals', bhl: 'Brampton Hockey', canadettes: 'Canadettes', silverstick: 'Silver Stick', mmeds: 'McLaughlin Meds', lessons: 'Learn to Skate', city: 'City of Brampton' };

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---- date helpers (all dates are 'YYYY-MM-DD' strings in Toronto time) ------

const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function torontoNow() {
  const p = Object.fromEntries(dtf.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const toUTC = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
const fromUTC = (dt) => dt.toISOString().slice(0, 10);
const addDays = (d, n) => { const dt = toUTC(d); dt.setUTCDate(dt.getUTCDate() + n); return fromUTC(dt); };
const fmtDate = (d, opts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts }).format(toUTC(d));
const longDate = (d) => fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(toUTC(s).getTime());

const mins = (hhmm) => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
function fmtClock(m) {
  m = ((m % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
/** "7:15–8:05 PM" (AM/PM only repeated when it changes) */
function fmtRange(s) {
  const a = fmtClock(s.s);
  if (s.e == null || s.slot.endEstimated) return a; // end time not published
  const b = fmtClock(s.e);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

// ---- state --------------------------------------------------------------------

let DATA = null;
let BY_DATE = new Map();
const state = { date: null, view: 'timeline', range: 'day', xp: new Set(), xk: new Set(), xs: new Set(), q: '' };

function readUrl() {
  const p = new URLSearchParams(location.search);
  if (isDate(p.get('d'))) state.date = p.get('d');
  const narrow = matchMedia('(max-width: 700px)').matches;
  state.view = ['timeline', 'agenda'].includes(p.get('v')) ? p.get('v') : narrow ? 'agenda' : 'timeline';
  state.range = p.get('r') === 'week' ? 'week' : 'day';
  const set = (key) => new Set((p.get(key) || '').split(',').filter(Boolean));
  state.xp = new Set([...set('xp')].map(Number));
  state.xk = set('xk');
  state.xs = set('xs');
  state.q = p.get('q') || '';
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.date !== torontoNow().date) p.set('d', state.date);
  p.set('v', state.view);
  if (state.range === 'week') p.set('r', 'week');
  if (state.xp.size) p.set('xp', [...state.xp].join(','));
  if (state.xk.size) p.set('xk', [...state.xk].join(','));
  if (state.xs.size) p.set('xs', [...state.xs].join(','));
  if (state.q) p.set('q', state.q);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

// ---- data ---------------------------------------------------------------------

function prepare(raw) {
  BY_DATE = new Map();
  for (const slot of raw.slots) {
    const s = mins(slot.start);
    let e = slot.end ? mins(slot.end) : null;
    if (e != null && e <= s) e = 1440; // runs past midnight; clip to end of day
    const item = { slot, s, e, hay: [slot.title, slot.team, slot.opponent, slot.org, slot.detail, KIND_SINGULAR[slot.kind]].join(' ').toLowerCase() };
    if (!BY_DATE.has(slot.date)) BY_DATE.set(slot.date, []);
    BY_DATE.get(slot.date).push(item);
  }
}

async function load() {
  const res = await fetch('data/schedule.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  DATA = await res.json();
  prepare(DATA);
}

function visibleOn(date) {
  const q = state.q.trim().toLowerCase();
  return (BY_DATE.get(date) || [])
    .filter((it) => {
      const { slot } = it;
      if (slot.pad != null && state.xp.has(slot.pad)) return false;
      if (state.xk.has(slot.kind)) return false;
      if (state.xs.has(slot.source)) return false;
      return !q || it.hay.includes(q);
    })
    .sort((a, b) => a.s - b.s || (a.slot.pad ?? 9) - (b.slot.pad ?? 9));
}

// ---- text helpers -------------------------------------------------------------

const cleanTeam = (t) => t.replace(/^\d{2}-\d{2}\s*•\s*/, ''); // drop "26-27 • " season prefix
function primary(slot) {
  if (slot.kind === 'unused') return 'Unused ice';
  if (slot.kind === 'game' || slot.kind === 'practice') return slot.team ? cleanTeam(slot.team) : slot.title;
  return slot.title;
}
function secondary(slot) {
  // club games: team is the headline and the title is "vs Opponent"; league games have no team, so show game no./result instead
  if (slot.kind === 'game') return slot.team ? slot.title : slot.detail || '';
  if (slot.kind === 'tournament' || slot.kind === 'lesson') return slot.detail || ''; // division/pool or session · status
  if (slot.kind === 'practice') return 'Practice';
  if (slot.kind === 'unused') return [slot.team, slot.org].filter(Boolean).join(' · ');
  return slot.spots || slot.price || '';
}

// ---- timeline -----------------------------------------------------------------

function layoutLanes(items) {
  // Greedy lane assignment inside clusters of overlapping events.
  const sorted = [...items].sort((a, b) => a.s - b.s);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanesEnd = [];
    for (const it of cluster) {
      let lane = lanesEnd.findIndex((end) => end <= it.s);
      if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(0); }
      lanesEnd[lane] = it.end;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = lanesEnd.length;
    cluster = [];
  };
  for (const it of sorted) {
    it.end = it.e ?? it.s + 60;
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return sorted;
}

const weekDays = () => Array.from({ length: 7 }, (_, i) => addDays(state.date, i));

function timeRange(items) {
  const startMin = Math.floor(Math.min(...items.map((i) => i.s)) / 60) * 60;
  const endMin = Math.max(startMin + 120, Math.ceil(Math.max(...items.map((i) => i.e ?? i.s + 60)) / 60) * 60);
  return { startMin, endMin };
}

function timelineAxis(startMin, endMin, height, perMin) {
  const axis = h('div', { class: 'tl-axis', style: `height:${height}px` });
  for (let m = startMin; m <= endMin; m += 60) {
    axis.append(h('span', { style: `top:${(m - startMin) * perMin}px` }, m === startMin || m === endMin ? '' : fmtClock(m).replace(':00 ', ' ')));
  }
  return axis;
}

/** One positioned event block. `showPad` adds a "P2" tag (used when pads share a column). */
function timelineBlock(it, startMin, perMin, showPad) {
  const hgt = Math.max((it.end - it.s) * perMin - 2, 18);
  const w = 100 / it.lanes;
  const cls = ['blk', `k-${it.slot.kind}`, it.lanes >= 3 ? 'dense' : '', hgt < 34 ? 'tiny' : hgt < 52 ? 'short' : ''].filter(Boolean).join(' ');
  const sec = secondary(it.slot);
  const padTag = showPad && it.slot.pad != null ? ` · P${it.slot.pad}` : '';
  return h('button', {
    type: 'button', class: cls,
    style: `top:${(it.s - startMin) * perMin}px;height:${hgt}px;left:calc(${it.lane * w}% + 3px);width:calc(${w}% - 6px)`,
    title: `${fmtRange(it)}${padTag} · ${primary(it.slot)}${sec ? ' · ' + sec : ''}`,
    onclick: () => openDetail(it),
  },
    h('span', { class: 't' }, fmtRange(it) + padTag),
    h('span', { class: 'n' }, primary(it.slot)),
    h('span', { class: 'o' }, [sec, SHORT[it.slot.source]].filter(Boolean).join(' · ')));
}

function renderTimeline(root) {
  return state.range === 'week' ? renderWeekTimeline(root) : renderDayTimeline(root);
}

function renderDayTimeline(root) {
  const items = visibleOn(state.date);
  if (!items.length) return root.append(emptyState());

  const hasUnassigned = items.some((i) => i.slot.pad == null);
  const cols = [...PADS.filter((p) => !state.xp.has(p)), ...(hasUnassigned ? [null] : [])];
  const { startMin, endMin } = timeRange(items);
  const height = ((endMin - startMin) / 60) * HOUR_PX;
  const perMin = HOUR_PX / 60;
  const now = torontoNow();
  const showNow = now.date === state.date && now.min >= startMin && now.min <= endMin;

  const laid = new Map(cols.map((p) => [p, layoutLanes(items.filter((i) => i.slot.pad === p))]));
  const widths = cols.map((p) => {
    const lanes = Math.max(1, ...laid.get(p).map((i) => i.lanes));
    return Math.max(168, lanes * 112);
  });
  const grid = h('div', {
    class: 'tl',
    style: `grid-template-columns:56px ${widths.map((w) => `minmax(${w}px,${w}fr)`).join(' ')};min-width:${56 + widths.reduce((a, b) => a + b, 0)}px`,
  });
  grid.append(h('div', { class: 'tl-head' }));
  for (const p of cols) {
    const count = items.filter((i) => i.slot.pad === p).length;
    grid.append(h('div', { class: 'tl-head' }, p == null ? 'Pad unknown' : `Pad ${p}`, h('small', {}, `${count} slot${count === 1 ? '' : 's'}`)));
  }

  grid.append(timelineAxis(startMin, endMin, height, perMin));

  for (const p of cols) {
    const col = h('div', { class: 'tl-col', style: `height:${height}px;--hh:${HOUR_PX}px` });
    for (const it of laid.get(p)) col.append(timelineBlock(it, startMin, perMin, false));
    if (showNow) col.append(h('div', { class: 'now-line', style: `top:${(now.min - startMin) * perMin}px` }));
    grid.append(col);
  }
  root.append(h('div', { class: 'tl-scroll' }, grid));
}

/** Seven day columns on one shared time axis; the pads visible under the filters share each day. */
function renderWeekTimeline(root) {
  const days = weekDays();
  const perDay = days.map((d) => visibleOn(d));
  const all = perDay.flat();
  if (!all.length) return root.append(emptyState());

  const { startMin, endMin } = timeRange(all);
  const height = ((endMin - startMin) / 60) * HOUR_PX;
  const perMin = HOUR_PX / 60;
  const now = torontoNow();

  const laid = perDay.map((items) => layoutLanes(items));
  const widths = laid.map((items) => Math.max(132, 100 * Math.max(1, ...items.map((i) => i.lanes))));
  const grid = h('div', {
    class: 'tl',
    style: `grid-template-columns:56px ${widths.map((w) => `minmax(${w}px,${w}fr)`).join(' ')};min-width:${56 + widths.reduce((a, b) => a + b, 0)}px`,
  });
  grid.append(h('div', { class: 'tl-head' }));
  days.forEach((d, i) => {
    const n = perDay[i].length;
    grid.append(h('div', { class: `tl-head${d === now.date ? ' today' : ''}` }, shortDate(d), h('small', {}, n ? `${n} slot${n === 1 ? '' : 's'}` : 'nothing listed')));
  });
  grid.append(timelineAxis(startMin, endMin, height, perMin));

  days.forEach((d, i) => {
    const isToday = d === now.date;
    const col = h('div', { class: `tl-col${isToday ? ' today' : ''}`, style: `height:${height}px;--hh:${HOUR_PX}px` });
    for (const it of laid[i]) col.append(timelineBlock(it, startMin, perMin, true));
    if (isToday && now.min >= startMin && now.min <= endMin) col.append(h('div', { class: 'now-line', style: `top:${(now.min - startMin) * perMin}px` }));
    grid.append(col);
  });
  root.append(h('div', { class: 'tl-scroll' }, grid));
}

// ---- agenda -------------------------------------------------------------------

function renderAgenda(root) {
  const days = state.range === 'week' ? weekDays() : [state.date];
  const now = torontoNow();
  let any = false;
  for (const d of days) {
    const items = visibleOn(d);
    if (!items.length) continue;
    any = true;
    const rel = d === now.date ? 'Today' : d === addDays(now.date, 1) ? 'Tomorrow' : '';
    const list = h('ul', { class: 'ag-list' });
    for (const it of items) {
      const { slot } = it;
      const past = d === now.date && (it.e ?? it.s + 60) <= now.min;
      const sub = [secondary(slot), SHORT[slot.source]].filter(Boolean).join(' · ');
      list.append(h('li', {},
        h('button', { type: 'button', class: `ag-row k-${slot.kind}${past ? ' past' : ''}`, onclick: () => openDetail(it) },
          h('span', { class: 'ag-time' }, fmtRange(it)),
          h('span', { class: 'ag-pad' }, slot.pad == null ? 'Pad ?' : `Pad ${slot.pad}`),
          h('span', { class: 'ag-main' }, h('div', { class: 'ag-title' }, primary(slot)), sub && h('div', { class: 'ag-sub' }, sub)),
          h('span', { class: 'ag-tag' }, KIND_SINGULAR[slot.kind]))));
    }
    root.append(h('div', { class: 'ag-day' }, h('h3', {}, shortDate(d), rel && h('span', { class: 'rel' }, rel)), list));
  }
  if (!any) root.append(emptyState());
}

function emptyState() {
  const dates = [...BY_DATE.keys()].sort();
  const days = state.range === 'week' ? weekDays() : [state.date];
  const outside = days[0] > dates.at(-1) || days.at(-1) < dates[0];
  const filtered = days.some((d) => (BY_DATE.get(d) || []).length > 0);
  return h('div', { class: 'empty' },
    h('strong', {}, filtered ? 'Nothing matches your filters' : 'No ice listed'),
    filtered
      ? 'Try resetting the filters.'
      : outside
        ? `Schedules are available from ${shortDate(dates[0])} to ${shortDate(dates.at(-1))}.`
        : 'Nothing is published for this date yet. The City of Brampton only posts public skating about two weeks ahead.');
}

// ---- detail dialog ------------------------------------------------------------

function openDetail(it) {
  const { slot } = it;
  const rows = [
    ['When', `${longDate(slot.date)}, ${fmtRange(it)}${slot.endEstimated ? ' (end time not published)' : ''}`],
    ['Pad', slot.pad == null ? 'Not specified' : `Pad ${slot.pad}`],
    slot.team && ['Team', slot.team],
    slot.opponent && ['Opponent', slot.opponent],
    slot.price && ['Price', slot.price],
    slot.spots && ['Availability', slot.spots],
    slot.detail && slot.detail !== secondary(slot) && !['public', 'shinny', 'tournament', 'lesson'].includes(slot.kind) && ['Notes', slot.detail],
    ['Source', slot.org],
  ].filter(Boolean);
  $('#detailBody').replaceChildren(
    h('div', { class: `k-${slot.kind}` },
      h('span', { class: 'badge' }, KIND_SINGULAR[slot.kind]),
      h('h3', { id: 'detailTitle' }, primary(slot)),
      secondary(slot) && h('div', { class: 'ag-sub' }, secondary(slot)),
      h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('a', { class: 'btn', href: slot.url, target: '_blank', rel: 'noopener' }, `Open on ${SHORT[slot.source] || slot.org} ↗`)));
  $('#detail').showModal();
}

// ---- chrome (heading, chips, footer) -----------------------------------------

function renderHeading() {
  $('#heading').textContent =
    state.range === 'week'
      ? `${shortDate(state.date)} – ${shortDate(addDays(state.date, 6))}`
      : longDate(state.date);
  $('#date').value = state.date;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
  $('#q').value = state.q;
}

function chip(label, on, color, onclick) {
  return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), style: color ? `--c:${color}` : null, onclick },
    color && h('span', { class: 'sw' }), label);
}

function renderChips() {
  const toggle = (set, v) => { set.has(v) ? set.delete(v) : set.add(v); render(); };
  $('#padChips').replaceChildren(...PADS.map((p) => chip(`Pad ${p}`, !state.xp.has(p), null, () => toggle(state.xp, p))));
  const present = new Set(DATA.slots.map((s) => s.kind));
  $('#kindChips').replaceChildren(
    ...Object.entries(KINDS).filter(([k]) => present.has(k)).map(([k, label]) => chip(label, !state.xk.has(k), KIND_VAR(k), () => toggle(state.xk, k))));
  $('#srcChips').replaceChildren(
    ...DATA.sources.map((s) => chip(SHORT[s.id] || s.name, !state.xs.has(s.id), null, () => toggle(state.xs, s.id))));
}

function relTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function renderMeta() {
  const age = (Date.now() - new Date(DATA.generatedAt).getTime()) / 36e5;
  const failed = DATA.sources.filter((s) => !s.ok);
  const el = $('#freshness');
  el.className = `freshness${failed.length ? ' bad' : age > 6 ? ' stale' : ''}`;
  el.replaceChildren(h('span', { class: 'fresh-dot' }),
    `Updated ${relTime(DATA.generatedAt)}${failed.length ? ` · ${failed.length} source${failed.length > 1 ? 's' : ''} unavailable` : age > 6 ? ' · may be out of date' : ''}`);
  el.title = new Date(DATA.generatedAt).toLocaleString('en-CA', { timeZone: TZ });

  const last = {};
  for (const s of DATA.slots) if (!last[s.source] || s.date > last[s.source]) last[s.source] = s.date;
  $('#sources').replaceChildren(...DATA.sources.map((s) => h('li', {},
    h('span', { class: 'st' }, s.ok ? '✓' : '✗'),
    h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name),
    s.ok ? ` — ${s.count} slots${last[s.id] ? ` through ${shortDate(last[s.id])}` : ''}` : ` — failed (${s.error})`)));
}

function render() {
  const active = state.xp.size + state.xk.size + state.xs.size + (state.q.trim() ? 1 : 0);
  $('#fcount').hidden = !active;
  $('#fcount').textContent = `${active} active`;
  renderHeading();
  renderChips();
  const root = $('#view');
  root.replaceChildren();
  (state.view === 'timeline' ? renderTimeline : renderAgenda)(root);
  writeUrl();
}

// ---- events -------------------------------------------------------------------

function step(dir) {
  const n = state.range === 'week' ? 7 : 1;
  state.date = addDays(state.date, dir * n);
  render();
}

function bind() {
  $('#prev').onclick = () => step(-1);
  $('#next').onclick = () => step(1);
  $('#today').onclick = () => { state.date = torontoNow().date; render(); };
  $('#date').onchange = (e) => { if (isDate(e.target.value)) { state.date = e.target.value; render(); } };
  document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { state.view = b.dataset.view; render(); }));
  document.querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => { state.range = b.dataset.range; render(); }));
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 150); };
  $('#reset').onclick = () => { state.xp.clear(); state.xk.clear(); state.xs.clear(); state.q = ''; render(); };
  $('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 10 * 60 * 1000);
}

async function refresh() {
  try {
    const before = DATA?.generatedAt;
    await load();
    if (DATA.generatedAt !== before) { renderMeta(); render(); } else renderMeta();
  } catch { /* keep showing what we have */ }
}

(async function init() {
  readUrl();
  if (matchMedia('(max-width: 700px)').matches) $('#filters').open = false;
  try {
    await load();
  } catch (err) {
    $('#freshness').textContent = 'Schedule data unavailable';
    $('#view').append(h('div', { class: 'empty' }, h('strong', {}, "Couldn't load the schedule"), String(err.message || err)));
    return;
  }
  const today = torontoNow().date;
  state.date ||= today;
  bind();
  renderMeta();
  render();
})();
