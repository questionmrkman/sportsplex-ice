import { test } from 'node:test';
import assert from 'node:assert/strict';
import { to24h, padFrom, isFennell, parseTeamCalendar, parsePerfectMindClass } from './sources.js';

const site = { id: 'capitals', name: 'Credit River Capitals', url: 'https://example.test/Calendar/' };

test('to24h converts 12-hour clock text', () => {
  assert.equal(to24h('4:40 PM'), '16:40');
  assert.equal(to24h('-12:15 AM'), '00:15');
  assert.equal(to24h('12:05 PM'), '12:05');
  assert.equal(to24h(''), null);
});

test('padFrom understands each site\'s naming', () => {
  assert.equal(padFrom('Susan Fennell Sportsplex (Pad 2)'), 2);
  assert.equal(padFrom('Susan Fennell (Pad 3)'), 3);
  assert.equal(padFrom('Susan Fennell Sportsplex - Rink 4'), 4);
  assert.equal(padFrom('SF Arena Ice (1) 0:00'), 1);
  assert.equal(padFrom('Terry Miller'), null);
});

test('isFennell matches Fennell venues only', () => {
  assert.ok(isFennell('Susan Fennell (Pad 1)'));
  assert.ok(isFennell('SF Arena Ice (4) 0:15'));
  assert.ok(!isFennell('Earnscliffe (Pad 2)'));
  assert.ok(!isFennell('Terry Miller'));
});

const item = (time, tag, owner, text, loc, extra = '') => `
  <div class="event-list-item"><div class="content"><div class="grid-x">
    <div class="time-primary">${time[0]}</div>${time[1] ? `<div class="time-secondary">-${time[1]}</div>` : ''}
    <div class="tag-list"><div class="tag ${tag.toLowerCase()}">${tag}</div></div>
    <div class="subject-owner">${owner}</div>
    <div class="subject-text">${text}${extra}</div>
    <div class="location local">${loc}</div>
  </div></div></div>`;

test('parseTeamCalendar keeps only Fennell slots and classifies them', () => {
  const html = `<div class="day-details other" id="day-Oct-26-2026">
    ${item(['6:15 PM', '7:45 PM'], 'Practice', 'U11', 'Practice', 'Susan Fennell Sportsplex (Pad 2)')}
    ${item(['7:00 PM'], 'Home Game', 'U13', 'vs Oakville Rangers', 'Susan Fennell (Pad 1)', '<span class="game_no">G1</span>')}
    ${item(['4:40 PM', '5:00 PM'], 'Practice', 'UNUSED ICE', 'Unused Ice', 'Susan Fennell Sportsplex (Pad 1)')}
    ${item(['8:00 PM', '9:00 PM'], 'Practice', 'U9', 'Practice', 'Earnscliffe (Pad 2)')}
  </div>`;
  const slots = parseTeamCalendar(html, site);
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((s) => s.kind), ['practice', 'game', 'unused']);
  assert.equal(slots[0].date, '2026-10-26');
  assert.equal(slots[0].start, '18:15');
  assert.equal(slots[0].end, '19:45');
  assert.equal(slots[0].pad, 2);
  // games publish no end time: estimated at 90 minutes
  assert.equal(slots[1].end, '20:30');
  assert.equal(slots[1].endEstimated, true);
  assert.equal(slots[1].opponent, 'Oakville Rangers');
  assert.equal(slots[1].detail.startsWith('G1'), true);
});

test('parsePerfectMindClass maps City programs', () => {
  const base = {
    EventName: 'Shinny Drop-In (18+ Years) | Susan Fennell Sportsplex 10:00-11:50am',
    Facility: 'SF Arena Ice (1) 0:00',
    Location: "Susan Fennell Sportsplex (South Fletcher's)",
    OccurrenceDate: '20261113',
    FormattedStartTime: '10:00 AM',
    FormattedEndTime: '11:50 AM',
    Spots: '26 spots left',
    PriceRange: '$0.00 - $5.43',
  };
  const s = parsePerfectMindClass(base, { id: 'city', name: 'City', url: 'https://x.test' });
  assert.equal(s.date, '2026-11-13');
  assert.equal(s.kind, 'shinny');
  assert.equal(s.pad, 1);
  assert.equal(s.end, '11:50');
  assert.equal(s.title, 'Shinny Drop-In (18+ Years)');

  const other = { ...base, EventName: 'Public Skate | Earnscliffe', Facility: 'ERC Arena Ice (1) 0:00', Location: 'Earnscliffe Recreation Centre' };
  assert.equal(parsePerfectMindClass(other, { id: 'city', name: 'City', url: 'https://x.test' }), null);
});
