import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  to24h, padFrom, isFennell, parseTeamCalendar, parsePerfectMindClass,
  parseTournamentDay, tournamentDate, tournamentDayLinks, parsePerfectMindCourse, torontoParts, parseHockeyLeagueStats,
} from './sources.js';

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

const tGame = (time, group, pool, home, away, no, loc, score = '') => `
  <div class="event-list-item"><div class="content"><div class="hover-overlay">
    <a href="/Tournaments/31575/Games/${no.replace(/\D/g, '')}/">Game Details</a></div><div class="grid-x">
    <div class="time-primary">${time}</div>
    <div class="tag-list"><div class="tag fullwidth division_1">${group}</div><div class="tag division_2">${pool}</div></div>
    <div class="subject-group">${group}</div><div class="subject-owner neutral">${home}</div>
    <div class="subject-text neutral">@ ${away}<span class="game_no">${no}</span></div>
    <div class="location local">${loc}</div><div class="game_score">${score}</div>
  </div></div></div>`;

test('tournament day pages: date, links and Fennell-only games', () => {
  const html = `<a href="/Tournaments/31575/Schedule/?Day=21&Month=11&Year=2026">Nov 21, 2026</a>
    <a href="/Tournaments/31575/Schedule/?Day=22&Month=11&Year=2026">Nov 22, 2026</a>
    <div class="heading-1"><span class="text">Nov 20, 2026</span></div>
    ${tGame('8:00 AM', 'U14 AA', 'Pool A', 'North York Knights', 'Burlington Eagles', 'RR112', 'Susan Fennell (Pad 3) ')}
    ${tGame('9:20 AM', 'U14 AA', 'Pool B', 'Team X', 'Team Y', 'RR2', 'CAA Centre - Red')}
    ${tGame('10:40 AM', 'U16 BB', 'Pool C', 'Team P', 'Team Q', 'RR3', 'Susan Fennell (Pad 1)', '3-2')}`;
  const site = { id: 'silverstick', name: 'Silver Stick', url: 'https://silverstick.org/Tournaments/31575/Schedule/' };
  assert.equal(tournamentDate(html), '2026-11-20');
  assert.deepEqual(tournamentDayLinks(html, site.url).map((u) => new URL(u).searchParams.get('Day')), ['21', '22']);

  const slots = parseTournamentDay(html, site);
  assert.equal(slots.length, 2); // CAA Centre game is skipped
  assert.equal(slots[0].kind, 'tournament');
  assert.equal(slots[0].pad, 3);
  assert.equal(slots[0].title, 'North York Knights @ Burlington Eagles');
  assert.equal(slots[0].detail, 'U14 AA · Pool A · RR112');
  assert.equal(slots[0].end, '09:10');
  assert.equal(slots[0].endEstimated, true);
  assert.equal(slots[0].url, 'https://silverstick.org/Tournaments/31575/Games/112/');
  assert.match(slots[1].detail, /Score 3-2$/);
});

test('torontoParts reads PerfectMind instants in Toronto time (EDT and EST)', () => {
  assert.deepEqual(torontoParts('/Date(1790370300000)/'), { date: '2026-09-25', time: '17:05' }); // 21:05Z, EDT
  assert.deepEqual(torontoParts('/Date(1796153100000)/'), { date: '2026-12-01', time: '14:25' }); // 19:25Z, EST
  assert.equal(torontoParts('nope'), null);
});

test('parsePerfectMindCourse expands a course into its Fennell sessions', () => {
  const lessons = { id: 'lessons', name: 'City Learn to Skate' };
  const cal = { url: 'https://x.test/cal' };
  const course = {
    EventId: 'e1', EventName: 'Skating 1A ( 3 to 6 Years)', Location: "Susan Fennell Sportsplex (South Fletcher's)",
    Facility: 'SF Arena Ice (4) 0:15', BookButtonText: 'CLOSED', Spots: '', PriceRange: '$103.40 - $155.10', NumberOfSessions: 2,
    Occurrences: [
      { StartDateWithOffset: '/Date(1790370300000)/', EndDateWithOffset: '/Date(1790372100000)/', OccurrenceOrderNumber: 0 },
      { StartDateWithOffset: '/Date(1790975100000)/', EndDateWithOffset: '/Date(1790976900000)/', OccurrenceOrderNumber: 1 },
    ],
  };
  const slots = parsePerfectMindCourse(course, lessons, cal);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].date, '2026-09-25');
  assert.equal(slots[0].start, '17:05');
  assert.equal(slots[0].end, '17:35');
  assert.equal(slots[0].pad, 4);
  assert.equal(slots[0].kind, 'lesson');
  assert.equal(slots[0].price, null); // fees aren't shown for lessons
  assert.equal(slots[0].title, 'Skating 1A (3 to 6 Years)');
  assert.equal(slots[1].detail, 'Session 2 of 2 · Registration closed');
  assert.equal(slots[0].url, 'https://x.test/cal');

  const elsewhere = { ...course, Location: 'Earnscliffe Recreation Centre', Facility: 'ERC Arena Ice (1) 0:00' };
  assert.deepEqual(parsePerfectMindCourse(elsewhere, lessons, cal), []);
});

const hlsRow = (num, date, time, loc, home, hs, vs, visitor, link = '') => `
  <tr><td>${num}</td><td>${link ? `<a href="${link}">${date}</a>` : date}</td><td>${time}</td><td>${loc}</td>
  <td><b>${home}</b></td><td>${hs}</td><td>${vs}</td><td><b>${visitor}</b></td></tr>`;

test('parseHockeyLeagueStats: year from the season heading, results, Fennell-only', () => {
  const html = `<table><tr><td>MMeds &nbsp; Schedule : &nbsp;2026 / 2027 Regular Season</td></tr></table>
    <table><tr><td>Num</td><td>Date</td><td>Time</td><td>Location</td><td>Home</td><td>H Score</td><td>V Score</td><td>Visitor</td></tr>
    ${hlsRow(1, 'Sun-Sep 20', '8:00 am', 'Susan Fennell Rink 3', 'Leafs', '9', '6', 'Hawks', 'showgame.php?id=3299&did=14&sid=61')}
    ${hlsRow(25, 'Sun-Nov 15', '9:20 am', 'Susan Fennell Rink 3', 'Whalers', '', '', 'Habs')}
    ${hlsRow(43, 'Sun-Jan 03', '10:40 am', 'Susan Fennell Rink 3', 'Hawks', '', '', 'Bruins')}
    ${hlsRow(50, 'Sun-Jan 10', '8:00 am', 'Earnscliffe Rink 1', 'Leafs', '', '', 'Habs')}</table>`;
  const site = { id: 'mmeds', name: 'McLaughlin Meds Hockey League', url: 'https://x.test/?go=schedule&did=14&sid=61' };
  const slots = parseHockeyLeagueStats(html, site);
  assert.equal(slots.length, 3); // Earnscliffe skipped
  assert.deepEqual(slots.map((s) => s.date), ['2026-09-20', '2026-11-15', '2027-01-03']); // Sep-Dec: 2026, Jan: 2027
  assert.equal(slots[0].start, '08:00');
  assert.equal(slots[0].pad, 3);
  assert.equal(slots[0].kind, 'game');
  assert.equal(slots[0].title, 'Leafs vs Hawks');
  assert.equal(slots[0].detail, 'Game 1 · Final 9–6');
  assert.equal(slots[0].url, 'https://x.test/showgame.php?id=3299&did=14&sid=61');
  assert.equal(slots[1].detail, 'Game 25'); // unplayed: no result
  assert.equal(slots[1].url, site.url);
  assert.throws(() => parseHockeyLeagueStats('<table><tr><td>nothing</td></tr></table>', site), /season/);
});

test('parseHockeyLeagueStats: "2026/27" headings, "7:00pm" times and the South Fletchers venue name', () => {
  const html = `<table><tr><td>C Schedule : 2026/27 TGIF Mens Hockey</td></tr></table>
    <table>${hlsRow(1, 'Fri-Oct 09', '7:00pm', 'South Fletchers Sportplex', 'Wolves', '0', '6', 'Here4Beer', 'showgame.php?id=2692&did=13&sid=48')}
    ${hlsRow(2, 'Fri-Jan 08', '9:00pm', 'South Fletchers Sportplex', 'Dragons', '', '', 'City Front')}
    ${hlsRow(3, 'Fri-Oct 16', '7:00pm', 'Terry Miller', 'Chiefs', '', '', 'Tailgators')}</table>`;
  const site = { id: 'tgif', name: "TGIF Men's Hockey", url: 'https://x.test/tgif/?go=schedule', gameMinutes: 60 };
  const slots = parseHockeyLeagueStats(html, site);
  assert.equal(slots.length, 2); // Terry Miller skipped
  assert.deepEqual(slots.map((s) => s.date), ['2026-10-09', '2027-01-08']);
  assert.equal(slots[0].start, '19:00');
  assert.equal(slots[0].end, '20:00'); // site.gameMinutes
  assert.equal(slots[0].pad, null); // the venue name has no pad number
  assert.equal(slots[1].start, '21:00');
  assert.ok(isFennell("South Fletcher's Sportsplex"));
});
