#!/usr/bin/env node
// The scoring screen's helpers. No browser.
//   node scripts/check-score-helpers.mjs
import { endChangeAt, isGamePoint, runningTimeout, scoreCall, timeoutsLeft } from '../src/lib/scoreHelpers.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const d = (over) => ({ isDoubles: true, servingTeam: 'A', serverNumber: 1, score: { A: 4, B: 2 }, pointTarget: 11, completed: false, ...over })

check('doubles call: serving score, receiving score, server number', scoreCall(d()), '4 – 2 – 1')
check('the receiving side serving reads from their side', scoreCall(d({ servingTeam: 'B', serverNumber: 2 })), '2 – 4 – 2')
check('the opening call is 0 – 0 – 2', scoreCall(d({ score: { A: 0, B: 0 }, serverNumber: 2 })), '0 – 0 – 2')
check('singles call has two numbers', scoreCall(d({ isDoubles: false, serverNumber: null })), '4 – 2')

check('10–8 serving -> game point', isGamePoint(d({ score: { A: 10, B: 8 } })), true)
check('10–9 serving -> game point', isGamePoint(d({ score: { A: 10, B: 9 } })), true)
check('10–10 serving -> not (win by 2)', isGamePoint(d({ score: { A: 10, B: 10 } })), false)
check('11–10 serving -> game point', isGamePoint(d({ score: { A: 11, B: 10 } })), true)
check('receiving side near 11 -> not (only the server scores)', isGamePoint(d({ score: { A: 4, B: 10 } })), false)
check('to 15: 14–12 -> game point', isGamePoint(d({ score: { A: 14, B: 12 }, pointTarget: 15 })), true)
check('a won game is not game point', isGamePoint(d({ score: { A: 11, B: 8 }, completed: true })), false)

check('switch ends at 6, 8, 11', [11, 15, 21].map(endChangeAt), [6, 8, 11])

const t = (team, at = 0) => ({ type: 'timeout', id: `t${team}${at}`, at, team })
check('2 timeouts in a game to 11', timeoutsLeft([], 'A', 11), 2)
check('3 in a game to 21', timeoutsLeft([], 'B', 21), 3)
check('one used leaves one', timeoutsLeft([t('A')], 'A', 15), 1)
check('the other side keeps theirs', timeoutsLeft([t('A'), t('A')], 'B', 11), 2)
check('never below zero', timeoutsLeft([t('A'), t('A'), t('A')], 'A', 11), 0)

const now = 1_000_000
check('a timeout as the last event, 20 s ago, is running', runningTimeout([t('B', now - 20_000)], now), { team: 'B', endsAt: now + 40_000 })
check('over a minute ago it is not', runningTimeout([t('B', now - 61_000)], now), null)
check('a rally after it ends it', runningTimeout([t('B', now - 5_000), { type: 'rally', id: 'r', at: now }], now), null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
