#!/usr/bin/env node
// ============================================================
// The scorekeeper re-entry guard: after an overturned call, the next
// rally must give the point to the team the umpire ruled for.
//
//   node scripts/check-reentry.mjs
// ============================================================
const { reentryMismatch } = await import('../server/src/scorekeeper-rules.js')

let fail = 0
function check(label, actual, expected) {
  if (actual !== expected) fail += 1
  console.log(`  ${actual === expected ? 'ok  ' : 'FAIL'} ${label}`)
}

const teamA = ['a1', 'a2']
check('nothing waiting: any rally is fine', reentryMismatch(null, teamA, { actingPlayerId: 'a1', outcome: 'winner' }), false)
check('B waits, B wins by a mistake of A', reentryMismatch('B', teamA, { actingPlayerId: 'a1', outcome: 'error' }), false)
check('B waits, B wins with a winner', reentryMismatch('B', teamA, { actingPlayerId: 'b1', outcome: 'winner' }), false)
check('B waits, A wins', reentryMismatch('B', teamA, { actingPlayerId: 'a1', outcome: 'winner' }), true)
check('A waits, A is credited a mistake of B', reentryMismatch('A', teamA, { actingPlayerId: 'b1', outcome: 'error' }), false)
process.exit(fail ? 1 : 0)
