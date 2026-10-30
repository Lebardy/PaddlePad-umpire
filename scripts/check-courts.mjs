#!/usr/bin/env node
// ============================================================
// Which open play courts a phone may start, and how their hours
// read (src/lib/courtRules.js). No browser, no network.
//
//   node scripts/check-courts.mjs
// ============================================================

import { startableCourts, hoursWords } from '../src/lib/courtRules.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const NOW = Date.parse('2026-10-30T09:30:00Z') // 5:30 PM Manila
const play = (courts) => ({ id: 'op1', startsAt: '2026-10-30T10:00:00Z', endsAt: '2026-10-30T13:00:00Z', courts })
const c = (court, assignedTo = null, started = false) => ({ court, assignedTo, started })
const ids = (list) => list.map((x) => `${x.court}${x.mine ? '*' : ''}`).join(',')

check('mine and open courts, not others', ids(startableCourts([play([c(1, 'other'), c(2, 'me'), c(3)])], [], NOW)), '2*,3')
check('a started court is gone', ids(startableCourts([play([c(2, 'me', true), c(3)])], [], NOW)), '3')
check('a court this phone already started (not yet sent) is gone',
  ids(startableCourts([play([c(2, 'me'), c(3)])], [{ openPlayId: 'op1', court: 3 }], NOW)), '2*')
check('more than an hour early: nothing', ids(startableCourts([play([c(2, 'me')])], [], Date.parse('2026-10-30T08:59:00Z'))), '')
check('after the end: nothing (a stale cache)', ids(startableCourts([play([c(2, 'me')])], [], Date.parse('2026-10-30T13:01:00Z'))), '')
check('mine first', ids(startableCourts([play([c(1), c(2, 'me')])], [], NOW)), '2*,1')
check('evening hours', hoursWords('2026-10-30T10:00:00Z', '2026-10-30T13:00:00Z'), '6–9 PM')
check('across noon', hoursWords('2026-10-30T02:00:00Z', '2026-10-30T06:00:00Z'), '10 AM–2 PM')

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
