#!/usr/bin/env node
// ============================================================
// Grouping a player's matches into months and nights, and the words on
// each row.
//
//   node player/scripts/check-nights.mjs
// ============================================================

process.env.TZ = 'Asia/Manila'

const { groupMatches, matchLine, monthLabel, nightLabel, recordText } = await import('../src/lib/nights.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

let n = 0
const m = (endedAt, won, extra = {}) => ({
  id: `m${(n += 1)}`, endedAt, won, sessionName: 'Friday Open Play', opponents: ['Rica Salazar', 'Denise Cabrera'],
  partner: 'Angela Soriano', yourScore: 11, theirScore: 7, pointTarget: 11, endedEarly: false, progression: null, ...extra,
})

console.log('records')
check('wins and losses', recordText([m('2026-09-12T12:00:00Z', true), m('2026-09-12T11:00:00Z', false), m('2026-09-12T10:00:00Z', true)]), '2–1')
check('a match with no result counts for neither', recordText([m('2026-09-12T12:00:00Z', null), m('2026-09-12T11:00:00Z', true)]), '1–0')

console.log('\nlabels')
const now = new Date('2026-09-28T04:00:00Z')
check('a month this year', monthLabel('2026-09-12T12:00:00Z', now), 'September')
check('a month in another year', monthLabel('2025-08-02T12:00:00Z', now), 'August 2025')
check('a month by Manila time, not UTC', monthLabel('2026-08-31T17:00:00Z', now), 'September')
check('a night', nightLabel('2026-09-12T12:00:00Z'), 'Sat, Sep 12')

console.log('\ngrouping')
const list = [
  m('2026-09-12T13:00:00Z', true),
  m('2026-09-12T12:00:00Z', false),
  m('2026-09-12T11:00:00Z', true, { sessionName: 'Early Birds' }),
  m('2026-09-05T12:00:00Z', true),
  m('2026-08-06T12:00:00Z', false),
]
const months = groupMatches(list)
check('two months, newest first', months.map((g) => [g.key, g.label, g.matches.length, g.record]),
  [['2026-09', 'September', 4, '3–1'], ['2026-08', 'August', 1, '0–1']])
check('same date, different session = two nights', months[0].nights.map((x) => [x.label, x.sessionName, x.matches.length, x.record]),
  [['Sat, Sep 12', 'Friday Open Play', 2, '1–1'], ['Sat, Sep 12', 'Early Birds', 1, '1–0'], ['Sat, Sep 5', 'Friday Open Play', 1, '1–0']])
check('nights follow Manila dates, not UTC ones',
  groupMatches([m('2026-09-13T00:30:00Z', true), m('2026-09-12T23:30:00Z', true)])[0].nights.length, 1)
check('months only when asked', groupMatches(list, { nights: false }).map((g) => g.nights), [null, null])
check('nothing in, nothing out', groupMatches([]), [])

console.log('\nthe small line under each row')
check('doubles, to 11', matchLine(m('2026-09-12T12:00:00Z', true)), 'with Angela Soriano')
check('singles, to 15, stopped early', matchLine(m('2026-09-12T12:00:00Z', true, { partner: null, pointTarget: 15, endedEarly: true })),
  'singles · to 15 · stopped early')
check('with its date when dated', matchLine(m('2026-09-12T12:00:00Z', true), { dated: true }), 'Sep 12 · with Angela Soriano')
check('with the story', matchLine(m('2026-09-12T12:00:00Z', true, { progression: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })),
  'with Angela Soriano · Never trailed')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
