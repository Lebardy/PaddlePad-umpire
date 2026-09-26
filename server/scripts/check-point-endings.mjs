#!/usr/bin/env node
// ============================================================
// How each point was won, and by whom.
//
//   node server/scripts/check-point-endings.mjs
//
// The player app's point-by-point boxes explain a tapped point: who
// scored, whether it was a winning shot or a mistake, and who hit it.
// pointEndings() supplies that, one entry per POINT, lined up with
// scoreProgression()'s margins -- so box i and ending i must always be
// the same rally. These check that promise:
//
//   1. A rally that only changed the serve is not a point, so it has
//      no entry, exactly as it has no margin.
//   2. A winning shot is credited to whoever hit it; a mistake to
//      whoever made it (the scoring side is the other one).
//   3. A rally logged before endings were recorded still has an entry,
//      just without the ending.
//   4. Nothing after the game was won is counted.
//
// Pure functions only: hand-built event logs, no database, no network.
// ============================================================

import { randomUUID } from 'node:crypto'
import { pointEndings, scoreProgression } from '../src/player-stats.js'
import { rallyEnding } from '../src/rally-endings.js'

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
  return { type: 'rally', id: randomUUID(), actingPlayerId, outcome: ending.outcome, zone: ending.zone, detail }
}

/** A rally from before endings were recorded: the two old facts only. */
function oldRally(actingPlayerId, outcome, zone = 'open') {
  return { type: 'rally', id: randomUUID(), actingPlayerId, outcome, zone }
}

const row = (pointTarget = 11) => ({
  team_a: [A],
  team_b: [B],
  first_server_team: 'A',
  first_server_player: A,
  right_start_a: 0,
  right_start_b: 0,
  point_target: pointTarget,
})

section('Only points, never serve changes')

{
  // A serves. A's ace: 1-0. A hits out: side out. B serves and steps in
  // the kitchen: side out. A serves, B nets it: 2-0. A's dink winner: 3-0.
  const log = [
    ended(A, 'ace'),
    ended(A, 'out'),
    ended(B, 'kitchen'),
    ended(B, 'net'),
    ended(A, 'dink_winner'),
  ]
  const points = pointEndings(row(), log)
  check(
    'three points from five rallies',
    points.length,
    3,
    'The two side-outs changed only the serve, so they are not boxes and must not be explanations either.',
  )
  check(
    'one entry per margin',
    points.length,
    scoreProgression(row(), log, 'A').length,
    'Box i is explained by entry i. If the two lists ever differ in length, every tap after the first gap explains the wrong point.',
  )
  check(
    'each point says how and who',
    points,
    [
      { how: 'winner', ending: 'ace', by: A },
      { how: 'mistake', ending: 'net', by: B },
      { how: 'winner', ending: 'dink_winner', by: A },
    ],
    'A winning shot names the player who hit it; a mistake names the player who made it, whose side did not score.',
  )
}

section('Rallies from before endings were recorded')

{
  const points = pointEndings(row(), [oldRally(A, 'winner'), oldRally(B, 'error', 'dink')])
  check(
    'still one entry per point, with no ending',
    points,
    [
      { how: 'winner', ending: null, by: A },
      { how: 'mistake', ending: null, by: B },
    ],
    'Older matches still get their boxes explained, just as "winning shot" or "mistake" without saying which kind.',
  )
}

section('The game ends where it ends')

{
  // A wins 3-0 in a game to 3, then one more rally is logged anyway.
  const log = [ended(A, 'ace'), ended(A, 'putaway'), ended(A, 'lob'), ended(A, 'passing')]
  check(
    'a rally after the winning point is not a point',
    pointEndings(row(3), log).map((p) => p.ending),
    ['ace', 'putaway', 'lob'],
    'The score stops at the winning point, so the boxes do; an explanation for a box that does not exist would shift nothing, but it would be wrong.',
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
