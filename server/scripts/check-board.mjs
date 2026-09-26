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
      match(['Gone'], ['Dee'], 11, 3),
      match(['Gone'], ['Eli'], 11, 4),
      match(['Gone'], ['Fay'], 11, 2),
      match(['Gone'], ['Gus'], 11, 1),
    ],
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Gone'),
  })
  check('played the most', board.playedMost, { names: ['Ana', 'Ben', 'Cy'], more: 0, count: 2 },
    'Gone played 4 but has closed their account, so the row goes to the next count — Ana, Ben and Cy on 2, shown as a tie, alphabetically')
}

// ============================================================
section('met the most people')
// ============================================================
{
  const board = buildBoard({
    matches: [
      match(['Ana'], ['Ben'], 11, 5),
      match(['Ben', 'Dee'], ['Eli', 'Fay'], 11, 8),
      match(['Gone'], ['Ben'], 11, 6),
    ],
    visible: everyone('Ana', 'Ben', 'Dee', 'Eli', 'Fay'),
    nameOf: names('Ana', 'Ben', 'Dee', 'Eli', 'Fay', 'Gone'),
  })
  check('met the most people', board.metMost, { names: ['Ben'], more: 0, count: 5 },
    'Ben met Ana, Dee, Eli, Fay and Gone; Dee, Eli and Fay met 3 each in one doubles game. A closed account still counts as someone Ben met — it is just never named')
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
    match(['Gone'], ['Ben'], 13, 11),
  ]
  const board = buildBoard({
    matches,
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee', 'Gone'),
  })
  check('the closest finished game', board.matchOfTheMonth && {
    teamA: board.matchOfTheMonth.teamA, teamB: board.matchOfTheMonth.teamB,
    score: board.matchOfTheMonth.score,
  }, { teamA: ['Cy'], teamB: ['Dee'], score: { A: 12, B: 10 } },
  '12-10 beats 11-9 on the same margin because it is the longer game; 10-9 was stopped early so is not a finished game; 13-11 has a closed account in it, and naming the other three would identify them')
  check('and why it was picked', board.matchOfTheMonth && {
    outOf: board.matchOfTheMonth.outOf,
    sameMargin: board.matchOfTheMonth.sameMargin,
    decidedBy: board.matchOfTheMonth.decidedBy,
  }, { outOf: 2, sameMargin: 2, decidedBy: 'length' },
  'chosen from the two games it could be (11-9 and 12-10), both won by two; neither carries any drama here, so length decides — the early and hidden-player games were never candidates')
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
  check('the later one, and says only that',
    [board.matchOfTheMonth.teamA, board.matchOfTheMonth.decidedBy], [['Cy'], 'recency'],
    'two identical 12-10s: the most recent wins the tie, and "the one that went furthest" would be untrue, so it is not claimed')
}

// ============================================================
section('drama beats length among games equally close')
// ============================================================
{
  // The 12-10 had the losers two game points from winning; the 14-12
  // swung more but the losers were never that close. Being nearly won
  // by the other side comes first, so the shorter game is picked.
  const nearlyLost = { savedByWinners: 2, leadChanges: 5, level: 6, savedByLosers: 0 }
  const longer = { savedByWinners: 0, leadChanges: 3, level: 7, savedByLosers: 4 }
  const board = buildBoard({
    matches: [
      { ...match(['Ana'], ['Ben'], 14, 12), game: longer },
      { ...match(['Cy'], ['Dee'], 12, 10), game: nearlyLost },
    ],
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee'),
  })
  check('the game the losers nearly won',
    [board.matchOfTheMonth.teamA, board.matchOfTheMonth.decidedBy], [['Cy'], 'losersGamePoints'],
    '12-10 beats 14-12: its losers had two game points and did not take them, which matters more than two extra points')

  const swung = buildBoard({
    matches: [
      { ...match(['Ana'], ['Ben'], 14, 12), game: { ...longer, leadChanges: 2 } },
      { ...match(['Cy'], ['Dee'], 12, 10), game: { ...nearlyLost, savedByWinners: 0 } },
    ],
    visible: everyone('Ana', 'Ben', 'Cy', 'Dee'),
    nameOf: names('Ana', 'Ben', 'Cy', 'Dee'),
  })
  check('with no game points against, the one that swung most',
    [swung.matchOfTheMonth.teamA, swung.matchOfTheMonth.decidedBy], [['Cy'], 'leadChanges'],
    'neither losing side had a game point, so five lead changes beats two')
}

// ============================================================
section('cleaner than these players usually play')
// ============================================================
{
  const past = (tag, players, clean) =>
    [1, 2, 3].map((i) => ({ id: `${tag}${i}`, players, clean }))
  const nobody = { savedByWinners: 0, leadChanges: 0, level: 0, savedByLosers: 0 }
  const everyoneHere = everyone('B1', 'B2', 'B3', 'B4', 'S1', 'S2', 'S3', 'S4', 'M1', 'M2', 'M3', 'M4', 'T1', 'T2', 'T3', 'T4')
  const allNames = names('B1', 'B2', 'B3', 'B4', 'S1', 'S2', 'S3', 'S4', 'M1', 'M2', 'M3', 'M4', 'T1', 'T2', 'T3', 'T4')

  // Beginners who usually play at 40% clean have a 50% game. A stronger
  // group who usually play at 80% have a 70% game that swung far more.
  const fair = buildBoard({
    matches: [
      { ...match(['B1', 'B2'], ['B3', 'B4'], 12, 10), clean: 0.5, game: { ...nobody, leadChanges: 1 } },
      { ...match(['S1', 'S2'], ['S3', 'S4'], 12, 10), clean: 0.7, game: { ...nobody, leadChanges: 5 } },
    ],
    visible: everyoneHere,
    nameOf: allNames,
    history: [...past('hb', ['B1', 'B2', 'B3', 'B4'], 0.4), ...past('hs', ['S1', 'S2', 'S3', 'S4'], 0.8)],
  })
  check('the beginners\' game, because it beat their own usual',
    [fair.matchOfTheMonth.teamA, fair.matchOfTheMonth.usualClean, fair.matchOfTheMonth.cleanBasis],
    [['B1', 'B2'], 0.4, 'players'],
    'the stronger game swung more but was below what those four usually play, so it was never eligible — every level gets in the same way, by playing better than they usually do')

  // The dramatic mess: three rallies in four ending in a mistake, below
  // its players' usual. The tidier game wins though it swung less.
  const tidy = buildBoard({
    matches: [
      { ...match(['M1', 'M2'], ['M3', 'M4'], 12, 10), clean: 0.24,
        game: { savedByWinners: 2, leadChanges: 5, level: 6, savedByLosers: 0 } },
      { ...match(['T1', 'T2'], ['T3', 'T4'], 14, 12), clean: 0.83,
        game: { savedByWinners: 0, leadChanges: 3, level: 7, savedByLosers: 4 } },
    ],
    visible: everyoneHere,
    nameOf: allNames,
    history: [...past('hm', ['M1', 'M2', 'M3', 'M4'], 0.59), ...past('ht', ['T1', 'T2', 'T3', 'T4'], 0.66)],
  })
  check('drama does not rescue a game played below its players\' usual',
    [tidy.matchOfTheMonth.teamA, tidy.matchOfTheMonth.outOf, tidy.matchOfTheMonth.decidedBy],
    [['T1', 'T2'], 1, 'margin'],
    'the 24% game had the losers two game points from winning, but it was far below its players\' usual 59%; the 83% game is the only eligible one')

  // No history at all: everyone is judged against the month's typical
  // game -- the middle of 30%, 50% and 70%, which is 50%.
  const fresh = buildBoard({
    matches: [
      { ...match(['B1', 'B2'], ['B3', 'B4'], 12, 10), clean: 0.3, game: { ...nobody, leadChanges: 6 } },
      { ...match(['S1', 'S2'], ['S3', 'S4'], 12, 10), clean: 0.5, game: { ...nobody, leadChanges: 2 } },
      { ...match(['T1', 'T2'], ['T3', 'T4'], 12, 10), clean: 0.7, game: { ...nobody, leadChanges: 1 } },
    ],
    visible: everyoneHere,
    nameOf: allNames,
  })
  check('new players are judged against the month\'s typical game',
    [fresh.matchOfTheMonth.teamA, fresh.matchOfTheMonth.sameMargin, fresh.matchOfTheMonth.cleanBasis],
    [['S1', 'S2'], 2, 'mixed'],
    'the 30% game is below the typical 50% and drops out despite the most lead changes; of the two left, the one that swung more wins, and the page is told this was not measured against their own history')
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
    { id: 'Gone', before: { winners: 1, errors: 9, matches: n }, thisMonth: { winners: 19, errors: 9, matches: n } },
    // Bigger again, but only two matches this month.
    { id: 'Few', before: { winners: 1, errors: 9, matches: n }, thisMonth: { winners: 19, errors: 9, matches: n - 1 } },
  ]
  const nameOf = names('Edge', 'Ana', 'Ben', 'Gone', 'Few')
  const visible = everyone('Edge', 'Ana', 'Ben', 'Few')

  const board = buildBoard({ matches: [], visible, nameOf, progress })
  check('the biggest gain, as a tie', board.biggestStepUp, { names: ['Ana', 'Ben'], more: 0 },
    `Ana and Ben both doubled; Gone gained more but has closed their account; Few gained more but played under ${n} matches this month`)

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
