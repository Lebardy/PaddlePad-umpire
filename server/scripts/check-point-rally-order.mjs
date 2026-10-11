#!/usr/bin/env node
// ============================================================
// Which rally each point was.
//
//   node server/scripts/check-point-rally-order.mjs
//
// A match's video has a place for every RALLY; the player app's boxes
// are one per POINT. pointRallyOrder() joins the two: for each point,
// the number of its rally among all the match's rallies. A rally that
// only changed the serve has a place in the video but no box, so its
// number is skipped; anything logged that is not a rally (a third shot,
// a server correction) is not counted at all.
//
// Pure functions only: hand-built event logs, no database, no network.
// ============================================================

import { randomUUID } from 'node:crypto'
import { pointEndings, pointRallyOrder, scoreProgression } from '../src/player-stats.js'
import { rallyEnding } from '../src/rally-endings.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const A = randomUUID()
const B = randomUUID()
const row = {
  team_a: [A], team_b: [B], first_server_team: 'A', first_server_player: A, right_start_a: 0, right_start_b: 0, point_target: 11,
}
/** A singles rally ended by `detail`, filed exactly as the app files it. */
function ended(actingPlayerId, detail) {
  const ending = rallyEnding(detail)
  return { type: 'rally', id: randomUUID(), actingPlayerId, outcome: ending.outcome, zone: ending.zone, detail }
}

// A serves. A's ace: 1-0. A hits out: side out. B serves and steps in
// the kitchen: side out. A serves, B nets it: 2-0. A's dink winner: 3-0.
const log = [ended(A, 'ace'), ended(A, 'out'), ended(B, 'kitchen'), ended(B, 'net'), ended(A, 'dink_winner')]
check('five rallies, three points: the two serve changes are skipped', pointRallyOrder(row, log), [0, 3, 4])
check('one entry per point, like the margins', pointRallyOrder(row, log).length, scoreProgression(row, log, 'A').length)
check('and like the endings', pointRallyOrder(row, log).length, pointEndings(row, log).length)

// The same match with a third shot logged before the fourth rally.
const withThird = [...log.slice(0, 3), { type: 'thirdShot', id: randomUUID(), playerId: A, shot: 'drop', landed: true }, ...log.slice(3)]
check('a third shot is not a rally, so the numbers do not move', pointRallyOrder(row, withThird), [0, 3, 4])
check('no rallies, no points', pointRallyOrder(row, []), [])
check('only serve changes, no points', pointRallyOrder(row, [ended(A, 'out'), ended(B, 'out')]), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
