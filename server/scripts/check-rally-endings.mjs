#!/usr/bin/env node
// ============================================================
// What ended the rally.
//
//   node server/scripts/check-rally-endings.mjs
//
// A rally now records WHAT ended it ("out of bounds", "kitchen fault")
// on top of the winner/error and dink/open facts it always carried.
// These check three promises that change makes:
//
//   1. Nothing that worked before stops working. The stat buckets come
//      out the same, and a rally with no detail -- every rally logged
//      before this -- is still a rally.
//   2. The detail is counted per player, and only for rallies that
//      actually counted towards the game.
//   3. A detail can never contradict the bucket it is filed in.
//
// Pure functions only: hand-built event logs, no database, no network.
// ============================================================

import { randomUUID } from 'node:crypto'
import { deriveMatchState } from '../src/pickleball.js'
import {
  RALLY_ENDINGS,
  rallyEnding,
  rallyEndingProblem,
  rallyEndingColumn,
  legacyRallyLabel,
} from '../src/rally-endings.js'
import { RAW_MATCH_LOG_COLUMNS } from '../src/export.js'

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
const section = (title) => console.log(`\n${title}`)

const A = randomUUID()
const B = randomUUID()

/** A singles rally ended by `detail`, filed exactly as the app files it. */
function ended(actingPlayerId, detail) {
  const ending = rallyEnding(detail)
  return {
    type: 'rally',
    id: randomUUID(),
    actingPlayerId,
    outcome: ending.outcome,
    zone: ending.zone,
    detail,
  }
}

const play = (events, pointTarget = 11) =>
  deriveMatchState({
    teamA: [A],
    teamB: [B],
    firstServer: { team: 'A', playerId: A },
    rightStart: { A: 0, B: 0 },
    pointTarget,
    events,
  })

section('The list itself')

check(
  'every ending has a unique key',
  new Set(RALLY_ENDINGS.map((e) => e.key)).size,
  RALLY_ENDINGS.length,
  'Keys are what a rally stores. Two endings sharing one would be indistinguishable forever after.',
)
check(
  'every ending files into one of the four existing buckets',
  RALLY_ENDINGS.filter(
    (e) => !['winner', 'error'].includes(e.outcome) || !['open', 'dink'].includes(e.zone),
  ).map((e) => e.key),
  [],
  'The ML export and the player app read those four buckets; an ending outside them would vanish from both.',
)
check(
  'only serve-related endings are credited to the server automatically',
  RALLY_ENDINGS.filter((e) => e.by === 'server').map((e) => e.key).sort(),
  ['ace', 'foot_fault', 'service'],
  'Skipping the "who" tap is only safe when the rules leave exactly one possible player.',
)

section('Buckets are unchanged by the detail')

{
  // A serves; A's ace scores 1-0; A goes out, side out; B serves and
  // makes a kitchen fault, side out; A hits a dink winner, 2-0.
  const derived = play([
    ended(A, 'ace'),
    ended(A, 'out'),
    ended(B, 'kitchen'),
    ended(A, 'dink_winner'),
  ])
  check(
    'A: one clean winner, one dink winner, one unforced error',
    [derived.stats[A].clean_winners, derived.stats[A].dink_winners, derived.stats[A].unforced_errors],
    [1, 1, 1],
    'An ace is a clean winner and out of bounds is an unforced error, exactly as the old buttons filed them.',
  )
  check(
    'B: one unforced error',
    derived.stats[B].unforced_errors,
    1,
    'A kitchen fault is still an ordinary mistake in the bucket the pipeline reads.',
  )
  check(
    'score is 2-0',
    derived.score,
    { A: 2, B: 0 },
    'The detail must not change who won a rally, only what it is called.',
  )
  check(
    'A is credited one ace, one out, one dink winner',
    derived.endings[A],
    { ace: 1, out: 1, dink_winner: 1 },
    'Counted per player, keyed by ending, with nothing listed that never happened.',
  )
  check(
    'B is credited one kitchen fault',
    derived.endings[B],
    { kitchen: 1 },
    'The player who made the fault carries it, not the player who won the point.',
  )
}

section('Older rallies, with no detail')

{
  const derived = play([
    { type: 'rally', id: randomUUID(), actingPlayerId: A, outcome: 'winner', zone: 'open' },
  ])
  check(
    'still scores and still fills its bucket',
    [derived.score.A, derived.stats[A].clean_winners],
    [1, 1],
    'Every match recorded before this change has no detail on any rally.',
  )
  check(
    'but adds no ending count',
    derived.endings[A],
    {},
    'Guessing "other winner" for an old rally would put invented detail into the export.',
  )
  check(
    'and is still described in the old words',
    [legacyRallyLabel('winner', 'open'), legacyRallyLabel('error', 'dink')],
    ['Clean winner', 'Dink error'],
    'The history list has to say something readable about a rally from before.',
  )
}

section('Only rallies that counted')

{
  // Game to 3... not allowed; use 11 and eleven straight aces, then one
  // more rally the fold must ignore.
  const aces = Array.from({ length: 11 }, () => ended(A, 'ace'))
  const derived = play([...aces, ended(B, 'out')])
  check(
    'the rally after the game was won is not counted',
    [derived.endings[A].ace, derived.endings[B]],
    [11, {}],
    'Scoring stops at game point; a detail from after it would describe a rally that never counted.',
  )
}

section('A detail that contradicts its bucket is refused')

check(
  'a known detail filed correctly is fine',
  rallyEndingProblem({ type: 'rally', outcome: 'error', zone: 'open', detail: 'net' }),
  null,
  'The normal case.',
)
check(
  'no detail at all is fine',
  rallyEndingProblem({ type: 'rally', outcome: 'error', zone: 'open' }),
  null,
  'Older copies of the app, still installed on phones, send rallies without one.',
)
check(
  'an unknown detail is refused',
  typeof rallyEndingProblem({ type: 'rally', outcome: 'error', zone: 'open', detail: 'gremlins' }),
  'string',
  'An ending the export has no column for would be silently lost.',
)
check(
  '"out of bounds" filed as a winner is refused',
  typeof rallyEndingProblem({ type: 'rally', outcome: 'winner', zone: 'open', detail: 'out' }),
  'string',
  'The bucket and the detail would tell two different stories about one point.',
)
check(
  '"missed dink" filed as an open-court error is refused',
  typeof rallyEndingProblem({ type: 'rally', outcome: 'error', zone: 'open', detail: 'dink_error' }),
  'string',
  'Zone matters too: it decides dink_errors against unforced_errors.',
)

section('The export')

check(
  'every ending has its own column, after the columns the pipeline reads',
  RALLY_ENDINGS.every((e) => RAW_MATCH_LOG_COLUMNS.includes(rallyEndingColumn(e.key))) &&
    RAW_MATCH_LOG_COLUMNS.indexOf(rallyEndingColumn(RALLY_ENDINGS[0].key)) >
      RAW_MATCH_LOG_COLUMNS.indexOf('uses_stacking'),
  true,
  'New columns go on the end, so the CSV stays a drop-in superset of what the pipeline already reads.',
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
