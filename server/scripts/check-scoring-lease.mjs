#!/usr/bin/env node
// ============================================================
// Which device may replace a match's list of taps.
//
//   node server/scripts/check-scoring-lease.mjs
//
// A tablet saves a match by sending every tap it has, and the server
// keeps the newest list. heldByAnotherDevice() decides whether a
// device has to be turned away first. These check that rule:
//
//   1. While a match is being played, the device scoring it keeps it
//      for 15 minutes after its last save.
//   2. After 15 quiet minutes another device may carry on, because
//      umpires hand courts over.
//   3. A FINISHED match stays with the device that finished it, so a
//      tablet coming back online with an older list cannot undo a
//      result.
//
// Pure, so no database and no network.
// ============================================================

import { heldByAnotherDevice } from '../src/scoring-lease.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}, got ${actual}`}`)
}

const NOW = Date.parse('2026-10-09T12:00:00Z')
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000)

// A match as the database row describes it: tablet A saved it last.
const match = (changes = {}) => ({
  status: 'in_progress',
  scoring_device: 'tablet-a',
  scoring_claimed_at: minutesAgo(1),
  ...changes,
})

console.log('\nwhile a match is being played')
check('a match nobody has scored yet is free',
  heldByAnotherDevice(match({ scoring_device: null, scoring_claimed_at: null }), 'tablet-b', NOW), false)
check('the device scoring it carries on',
  heldByAnotherDevice(match(), 'tablet-a', NOW), false)
check('another device is turned away',
  heldByAnotherDevice(match(), 'tablet-b', NOW), true)
check('still turned away 14 minutes after the last save',
  heldByAnotherDevice(match({ scoring_claimed_at: minutesAgo(14) }), 'tablet-b', NOW), true)
check('let in after 16 quiet minutes, so a court can be handed over',
  heldByAnotherDevice(match({ scoring_claimed_at: minutesAgo(16) }), 'tablet-b', NOW), false)

console.log('\nonce a match is finished')
const finishedAnHourAgo = match({ status: 'completed', scoring_claimed_at: minutesAgo(60) })
check('another device is turned away however long ago it ended',
  heldByAnotherDevice(finishedAnHourAgo, 'tablet-b', NOW), true)
check('the device that finished it may still correct it',
  heldByAnotherDevice(finishedAnHourAgo, 'tablet-a', NOW), false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
