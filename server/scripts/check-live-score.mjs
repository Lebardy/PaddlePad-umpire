#!/usr/bin/env node
// ============================================================
// The score a Camera screen shows. No database, no network.
//
//   node server/scripts/check-live-score.mjs
//
// Worked out from the match's events by the scoring engine: a point
// for the serving side, and a side-out moves the serve, not the score.
// ============================================================

import { liveScore } from '../src/live-score.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const row = (a, b) => ({
  team_a: a, team_b: b, first_server_team: 'A', first_server_player: a[0],
  right_start_a: 0, right_start_b: 0, point_target: 11,
})
// A rally the given player wins (or loses, with 'error').
const rally = (actingPlayerId, outcome) => ({ id: `r-${Math.random()}`, type: 'rally', actingPlayerId, outcome, zone: 'baseline' })

const singles = row(['a1'], ['b1'])
check('singles start 0-0, no server number', liveScore(singles, []), { a: 0, b: 0, serving: 'A', server: null })
check('a point for the serving side', liveScore(singles, [rally('a1', 'winner')]), { a: 1, b: 0, serving: 'A', server: null })
check('a side-out moves the serve, not the score', liveScore(singles, [rally('a1', 'error')]), { a: 0, b: 0, serving: 'B', server: null })

const doubles = row(['a1', 'a2'], ['b1', 'b2'])
check('doubles start 0-0 with the first server team on its second server', liveScore(doubles, []), { a: 0, b: 0, serving: 'A', server: 2 })
check('doubles: a point for the serving side', liveScore(doubles, [rally('a1', 'winner')]), { a: 1, b: 0, serving: 'A', server: 2 })
const sideOut = [rally('a1', 'error')]
check('doubles: the first lost rally is a side-out to server 1', liveScore(doubles, sideOut), { a: 0, b: 0, serving: 'B', server: 1 })
check('doubles: the next lost rally moves the serve to server 2', liveScore(doubles, [...sideOut, rally('b1', 'error')]), { a: 0, b: 0, serving: 'B', server: 2 })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
