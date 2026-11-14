import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facilitySlots, groupSource, kindFor, titleFor } from './facility.js';

const site = { id: 'facility', name: 'Susan Fennell facility schedule' };
const row = (over) => ({ pad: 2, date: '2026-11-16', start: '18:15', end: '22:45', event: '2026/27 FW CRC - Ice Schedule', service: 'Ice - Hockey', ...over });
const existing = (over) => ({ source: 'capitals', pad: 2, date: '2026-11-16', start: '18:15', end: '19:45', title: 'U10 Practice', ...over });

test('maps printed group names to the source that already lists them', () => {
  assert.equal(groupSource(row({})), 'capitals');
  assert.equal(groupSource(row({ event: '2026/27 FW BHI Ice Schedule - NOVEMBER' })), 'bhl');
  assert.equal(groupSource(row({ event: '2026/27 FW Br. Canadettes Girls Hockey - NOV' })), 'canadettes');
  assert.equal(groupSource(row({ event: '2026-27 FW Inner City Oldtimers Hockey League' })), 'icohl');
  assert.equal(groupSource(row({ event: 'Shinny Drop-In (18+ Years) | Susan Fennell Sportsplex', service: 'Drop-In Shinny' })), 'city');
  assert.equal(groupSource(row({ event: 'Skating 1A ( 3 to 6 Years)', service: 'Skating 1A' })), 'lessons');
  assert.equal(groupSource(row({ event: '2026-27 FW BMRHL Season' })), null); // a group no source covers
});

test('drops a row when its own group already lists something at that pad and time (keeps the existing slot)', () => {
  assert.deepEqual(facilitySlots([row({})], [existing()], site), []);
  // partial coverage still counts as listed: the extra time is deliberately not added
  assert.deepEqual(facilitySlots([row({ end: '23:15' })], [existing()], site), []);
});

test('keeps a row when the group has nothing listed there, or only on another pad/date/source', () => {
  assert.equal(facilitySlots([row({})], [], site).length, 1);
  assert.equal(facilitySlots([row({})], [existing({ pad: 3 })], site).length, 1);
  assert.equal(facilitySlots([row({})], [existing({ date: '2026-11-17' })], site).length, 1);
  assert.equal(facilitySlots([row({})], [existing({ source: 'bhl' })], site).length, 1); // different group
  assert.equal(facilitySlots([row({})], [existing({ start: '23:00', end: '23:30' })], site).length, 1); // no time overlap
});

test('rows from groups without a source are always added, with a clean title and the right type', () => {
  const rows = [
    row({ event: '2026-27 FW BMRHL Season' }),
    row({ event: '2026/27 F/W Youth Hockey Development Program (Coach Phil)', service: 'Internal - Program/Admin Hold' }),
    row({ event: '2026-27 ICE Wkly Maintenance Dates', service: 'Internal - Maintenance Hold' }),
  ];
  const slots = facilitySlots(rows, [existing()], site);
  assert.deepEqual(slots.map((s) => [s.kind, s.title]), [
    ['booking', 'BMRHL Season'],
    ['hold', 'Youth Hockey Development Program (Coach Phil)'],
    ['maintenance', 'Ice maintenance'],
  ]);
  assert.equal(slots[0].source, 'facility');
  assert.equal(slots[0].pad, 2);
  assert.equal(slots[0].end, '22:45');
  assert.equal(slots[0].endEstimated, false);
  assert.equal(slots[0].url, null);
});

test('kind and title helpers', () => {
  assert.equal(kindFor(row({ service: 'Drop-In Public Skate', event: 'Public Skate Drop-In (All Ages)' })), 'public');
  assert.equal(kindFor(row({ service: 'Drop-In Shinny', event: 'Shinny Drop-In (18+ Years)' })), 'shinny');
  assert.equal(titleFor(row({ event: '2026-27 FW Sheridan College - ARENA' })), 'Sheridan College - ARENA');
  assert.equal(titleFor(row({ event: 'Public Skate Drop-In (55+ Years) | Susan Fennell Sportsplex 1:15-2:05pm' })), 'Public Skate Drop-In (55+ Years)');
});
