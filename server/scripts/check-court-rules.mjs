// ============================================================
// Who may start a court of an open play, and when a court start
// becomes a plain session instead.
//
//   node server/scripts/check-court-rules.mjs
//
// A start that breaks a rule is kept as a plain session, never refused.
// Pure, so no database and no network.
// ============================================================

import { clampStartsAt, courtStartProblem, courtNoticeText } from '../src/court-rules.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}, got ${actual}`}`)
}

const NOW = new Date('2026-10-30T10:00:00Z') // 6 PM Manila
const at = (iso) => new Date(iso)
const play = { facilityId: 'f1', umpire: true, courts: 3, startsAt: at('2026-10-30T10:00:00Z'), endsAt: at('2026-10-30T13:00:00Z') }
const me = { id: 'u1', facilityId: 'f1' }
const base = { openPlay: play, umpire: me, court: 2, startsAt: at('2026-10-30T10:05:00Z'), assignee: null, heldBy: null }
const problem = (changes) => JSON.stringify(courtStartProblem({ ...base, ...changes }))

console.log('\nstart-time clamp')
check('a time a minute ago is kept', clampStartsAt('2026-10-30T09:59:00Z', NOW).toISOString(), '2026-10-30T09:59:00.000Z')
check('5 minutes ahead is kept', clampStartsAt('2026-10-30T10:05:00Z', NOW).toISOString(), '2026-10-30T10:05:00.000Z')
check('6 minutes ahead becomes now', clampStartsAt('2026-10-30T10:06:00Z', NOW).toISOString(), NOW.toISOString())
check('23 hours ago is kept (sent late from offline)', clampStartsAt('2026-10-29T11:00:00Z', NOW).toISOString(), '2026-10-29T11:00:00.000Z')
check('25 hours ago becomes now', clampStartsAt('2026-10-29T09:00:00Z', NOW).toISOString(), NOW.toISOString())
check('rubbish becomes now', clampStartsAt('soon', NOW).toISOString(), NOW.toISOString())
check('missing becomes now', clampStartsAt(undefined, NOW).toISOString(), NOW.toISOString())

console.log('\nwho may start a court')
check('unassigned court, inside the window', problem({}), 'null')
check('assigned to me', problem({ assignee: { id: 'u1', name: 'Joy Manalo', active: true } }), 'null')
check('assigned to someone else', problem({ assignee: { id: 'u2', name: 'Paolo Sy', active: true } }), JSON.stringify({ refused: "Court 2 is Paolo's tonight" }))
check('assignee paused, closed or moved counts as unassigned', problem({ assignee: { id: 'u2', name: 'Paolo Sy', active: false } }), 'null')
check('already held', problem({ heldBy: 'Joy Manalo' }), JSON.stringify({ taken: 'Joy' }))
check('no such open play', problem({ openPlay: null }), JSON.stringify({ refused: 'That open play is gone' }))
check('another facility', problem({ umpire: { id: 'u1', facilityId: 'f2' } }), JSON.stringify({ refused: 'That open play is gone' }))
check('open play without an umpire', problem({ openPlay: { ...play, umpire: false } }), JSON.stringify({ refused: 'That open play has no umpire' }))
check('court 0', problem({ court: 0 }), JSON.stringify({ refused: 'There is no Court 0' }))
check('court 4 of 3', problem({ court: 4 }), JSON.stringify({ refused: 'There is no Court 4' }))
check('exactly an hour before is fine', problem({ startsAt: at('2026-10-30T09:00:00Z') }), 'null')
check('more than an hour before', problem({ startsAt: at('2026-10-30T08:59:00Z') }), JSON.stringify({ refused: "That open play hadn't started" }))
check('at the end is fine', problem({ startsAt: at('2026-10-30T13:00:00Z') }), 'null')
check('after the end', problem({ startsAt: at('2026-10-30T13:01:00Z') }), JSON.stringify({ refused: 'That open play had ended' }))
check('started offline in the window, judged on its own time', problem({ startsAt: at('2026-10-30T12:30:00Z') }), 'null')

console.log('\nthe notice')
check('taken', courtNoticeText(2, { taken: 'Joy' }), 'Court 2 was already started by Joy. Saved as a plain session.')
check('refused', courtNoticeText(2, { refused: "Court 2 is Paolo's tonight" }), "Court 2 is Paolo's tonight. Saved as a plain session.")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
