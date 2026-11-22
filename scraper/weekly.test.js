import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklySlots } from './weekly.js';

const site = {
  id: 'oldboyz', name: "Men's Old Boyz", weekday: 0, pad: 4, from: '2026-11-22', until: '2027-03-28',
  sessions: [{ start: '10:15', end: '11:15' }, { start: '11:15', end: '12:15' }],
};

test('one slot per session on every Sunday, first and last dates included', () => {
  const slots = weeklySlots(site);
  const dates = [...new Set(slots.map((s) => s.date))];
  assert.equal(dates[0], '2026-11-22');
  assert.equal(dates.at(-1), '2027-03-28');
  assert.equal(dates.length, 19); // Nov 22 ... Mar 28, weekly
  assert.equal(slots.length, 38);
  assert.ok(dates.every((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0));
  assert.deepEqual(slots.slice(0, 2).map((s) => [s.start, s.end, s.pad, s.kind, s.detail]), [
    ['10:15', '11:15', 4, 'league', 'Weekly league · session 1 of 2'],
    ['11:15', '12:15', 4, 'league', 'Weekly league · session 2 of 2'],
  ]);
});

test('skipped dates are left out', () => {
  const dates = new Set(weeklySlots({ ...site, skip: ['2026-12-27'] }).map((s) => s.date));
  assert.ok(!dates.has('2026-12-27'));
  assert.ok(dates.has('2026-12-20') && dates.has('2027-01-03'));
});

test('rejects a start date on the wrong weekday', () => {
  assert.throws(() => weeklySlots({ ...site, from: '2026-11-23' }), /not weekday/);
});
