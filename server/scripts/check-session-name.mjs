// ============================================================
// The one rule that names a session.
//
//   node server/scripts/check-session-name.mjs
//
// Manila time whatever the phone's zone; minutes only when not :00.
// Pure, so no database and no network.
// ============================================================

import { sessionName } from '../src/session-name.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}, got ${actual}`}`)
}

console.log('\nplain sessions')
check('on the hour', sessionName({ startsAt: '2026-10-30T18:00:00+08:00' }), 'Session · Fri Oct 30, 6 PM')
check('minutes shown', sessionName({ startsAt: '2026-10-30T18:10:00+08:00' }), 'Session · Fri Oct 30, 6:10 PM')
check('five past', sessionName({ startsAt: '2026-10-30T07:05:00+08:00' }), 'Session · Fri Oct 30, 7:05 AM')
check('noon', sessionName({ startsAt: '2026-10-30T12:00:00+08:00' }), 'Session · Fri Oct 30, 12 PM')
check('midnight is the next day', sessionName({ startsAt: '2026-10-31T00:00:00+08:00' }), 'Session · Sat Oct 31, 12 AM')
check('a minute before midnight', sessionName({ startsAt: '2026-10-30T23:59:00+08:00' }), 'Session · Fri Oct 30, 11:59 PM')
check('a phone in another zone still gets Manila time', sessionName({ startsAt: '2026-10-30T10:45:00Z' }), 'Session · Fri Oct 30, 6:45 PM')
check('a Date works', sessionName({ startsAt: new Date('2026-10-30T10:00:00Z') }), 'Session · Fri Oct 30, 6 PM')
check('a timestamp works', sessionName({ startsAt: Date.parse('2026-10-30T10:00:00Z') }), 'Session · Fri Oct 30, 6 PM')

console.log('\nopen play courts')
check('court 2', sessionName({ startsAt: '2026-10-30T18:00:00+08:00', court: 2 }), 'Open Play · Court 2 · Fri Oct 30, 6 PM')
check('court 1', sessionName({ startsAt: '2026-10-30T09:00:00+08:00', court: 1 }), 'Open Play · Court 1 · Fri Oct 30, 9 AM')
check('court 20', sessionName({ startsAt: '2026-10-30T18:00:00+08:00', court: 20 }), 'Open Play · Court 20 · Fri Oct 30, 6 PM')
check('court null is plain', sessionName({ startsAt: '2026-10-30T18:00:00+08:00', court: null }), 'Session · Fri Oct 30, 6 PM')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
