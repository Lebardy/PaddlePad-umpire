#!/usr/bin/env node
// ============================================================
// The monthly board's rules, checked against answers written by hand.
//
//   node server/scripts/check-board.mjs
//
// buildBoard is pure -- plain data in, the board out -- so every rule
// that decides who is named can be proven here with no database, no
// network and no credentials. Ids double as names below so each
// expectation reads as English.
// ============================================================

import { buildBoard, STEP_UP_MIN_GAIN, STEP_UP_MIN_MATCHES } from '../src/board.js'

let pass = 0
let fail = 0

function check(label, actual, expected, why) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`) +
    `\n       ${why}`,
  )
}

function section(title) {
  console.log(`\n${title}`)
}

const names = (...ids) => new Map(ids.map((id) => [id, id]))
const everyone = (...ids) => new Set(ids)

let at = Date.parse('2026-09-01T10:00:00Z')
function match(teamA, teamB, A, B, extra = {}) {
  at += 3_600_000
  return {
    id: `m${at}`,
    teamA,
    teamB,
    score: { A, B },
    endedAt: new Date(at).toISOString(),
    endedEarly: false,
    ...extra,
  }
}

// ============================================================
section('played the most')
// ============================================================
{
  const board = buildBoard({
    matches: [
      match(['Ana'], ['Ben'], 11, 5),
      match(['Ana'], ['Cy'], 11, 7),
      match(['Ben'], ['Cy'], 11, 9),
      match(['Hid'], ['Dee'], 11, 3),
      match(['Hid'], ['Eli'], 11, 4),
      match(['Hid'], ['Fay'], 11, 2),
      match(['Hid'], ['Gus'], 11, 1),
    ],
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hid'),
  })
  check('played the most', board.playedMost, { names: ['Ana', 'Ben', 'Cy'], more: 0, count: 2 },
    'Hid played 4 but hides their name, so the row goes to the next count — Ana, Ben and Cy on 2, shown as a tie, alphabetically')
}

// ============================================================
section('met the most people')
// ============================================================
{
  const board = buildBoard({
    matches: [
      match(['Ana'], ['Ben'], 11, 5),
      match(['Ben', 'Dee'], ['Eli', 'Fay'], 11, 8),
      match(['Hid'], ['Ben'], 11, 6),
    ],
    visible: everyone('Ana', 'Ben', 'Dee', 'Eli', 'Fay'),
    nameOf: names('Ana', 'Ben', 'Dee', 'Eli', 'Fay', 'Hid'),
  })
  check('met the most people', board.metMost, { names: ['Ben'], more: 0, count: 5 },
    'Ben met Ana, Dee, Eli, Fay and Hid; Dee, Eli and Fay met 3 each in one doubles game. A hidden player still counts as someone Ben met — they are just never named')
}

// ============================================================
section('a tie too long to list')
// ============================================================
{
  const matches = [
    match(['A1'], ['A2'], 11, 9),
    match(['A3'], ['A4'], 11, 9),
    match(['A5'], ['A6'], 11, 9),
  ]
  const board = buildBoard({
    matches,
    visible: everyone('A1', 'A2', 'A3', 'A4', 'A5', 'A6'),
    nameOf: names('A1', 'A2', 'A3', 'A4', 'A5', 'A6'),
  })
  check('six tied on one match', board.playedMost, { names: ['A1', 'A2', 'A3'], more: 3, count: 1 },
    'past three names a tie becomes "and 3 more", so a quiet month does not turn the row into a list')
}

// ============================================================
section('match of the month')
// ============================================================
{
  const matches = [
    match(['Ana'], ['Ben'], 11, 9),
    match(['Cy'], ['Dee'], 12, 10),
    match(['Ana'], ['Cy'], 10, 9, { endedEarly: true }),
    match(['Hid'], ['Ben'], 13, 11),
  ]
  const board = buildBoard({
    matches,
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee', 'Hid'),
  })
  check('the closest finished game', board.matchOfTheMonth && {
    teamA: board.matchOfTheMonth.teamA, teamB: board.matchOfTheMonth.teamB,
    score: board.matchOfTheMonth.score,
  }, { teamA: ['Cy'], teamB: ['Dee'], score: { A: 12, B: 10 } },
  '12-10 beats 11-9 on the same margin because it is the longer game; 10-9 was stopped early so is not a finished game; 13-11 has a player who hides their name, and naming the other three would identify them')
  check('and why it was picked', board.matchOfTheMonth && {
    outOf: board.matchOfTheMonth.outOf,
    sameMargin: board.matchOfTheMonth.sameMargin,
    wentFurthest: board.matchOfTheMonth.wentFurthest,
  }, { outOf: 2, sameMargin: 2, wentFurthest: true },
  'chosen from the two games it could be (11-9 and 12-10), both won by two, and it went furthest — the early and hidden-player games were never candidates')
}

// ============================================================
section('two games level on margin AND length')
// ============================================================
{
  const board = buildBoard({
    matches: [match(['Ana'], ['Ben'], 12, 10), match(['Cy'], ['Dee'], 12, 10)],
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee'),
  })
  check('the later one, and not claimed to have gone furthest',
    [board.matchOfTheMonth.teamA, board.matchOfTheMonth.wentFurthest], [['Cy'], false],
    'two identical 12-10s: the most recent wins the tie, and "the one that went furthest" would be untrue, so it is not said')
}

// ============================================================
section('biggest step up — against their own earlier matches')
// ============================================================
{
  const n = STEP_UP_MIN_MATCHES
  const progress = [
    // (9+1)/(9+1) = 1.0 before, (11+1)/(9+1) = 1.2 now: exactly the
    // threshold, which must count.
    { id: 'Edge', before: { winners: 9, errors: 9, matches: n }, thisMonth: { winners: 11, errors: 9, matches: n } },
    // 0.5 before, 1.0 now: doubled.
    { id: 'Ana', before: { winners: 4, errors: 9, matches: n }, thisMonth: { winners: 9, errors: 9, matches: n } },
    { id: 'Ben', before: { winners: 4, errors: 9, matches: n }, thisMonth: { winners: 9, errors: 9, matches: n } },
    // Bigger again, but hidden.
    { id: 'Hid', before: { winners: 1, errors: 9, matches: n }, thisMonth: { winners: 19, errors: 9, matches: n } },
    // Bigger again, but only two matches this month.
    { id: 'Few', before: { winners: 1, errors: 9, matches: n }, thisMonth: { winners: 19, errors: 9, matches: n - 1 } },
  ]
  const nameOf = names('Edge', 'Ana', 'Ben', 'Hid', 'Few')
  const visible = everyone('Edge', 'Ana', 'Ben', 'Few')

  const board = buildBoard({ matches: [], visible, nameOf, progress })
  check('the biggest gain, as a tie', board.biggestStepUp, { names: ['Ana', 'Ben'], more: 0 },
    `Ana and Ben both doubled; Hid gained more but hides their name; Few gained more but played under ${n} matches this month`)

  const edgeOnly = buildBoard({ matches: [], visible, nameOf, progress: [progress[0]] })
  check(`a gain of exactly ${STEP_UP_MIN_GAIN * 100}% counts`, edgeOnly.biggestStepUp, { names: ['Edge'], more: 0 },
    '1.2 / 1.0 - 1 comes out as 0.19999999999999996 in floating point; "at least 20%" has to survive that')

  const slight = buildBoard({
    matches: [], visible, nameOf,
    progress: [{ id: 'Edge', before: { winners: 9, errors: 9, matches: n }, thisMonth: { winners: 10, errors: 9, matches: n } }],
  })
  check('a small gain leaves the row empty', slight.biggestStepUp, null,
    '1.0 to 1.1 is a wobble, not a step up — naming nobody is the honest answer')
}

// ============================================================
section('a month with nothing in it')
// ============================================================
{
  const board = buildBoard({ matches: [], visible: new Set(), nameOf: new Map() })
  check('every row empty', board, { playedMost: null, metMost: null, matchOfTheMonth: null, biggestStepUp: null },
    'the first day of a month has no board yet, and it must say so rather than throw')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
