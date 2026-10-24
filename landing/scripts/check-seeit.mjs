#!/usr/bin/env node
// ============================================================
// The See it screens are copies of the real apps' screens, so the parts
// that can drift are held to their sources: the umpire's scoring keys
// to server/src/rally-endings.js and src/components/Icon.jsx, and the
// sample game to the score the sample rally changes.
//
//   node landing/scripts/check-seeit.mjs
// ============================================================

import { readFileSync } from 'node:fs'
import { RALLY_ENDINGS } from '../../server/src/rally-endings.js'
import { ENDINGS } from '../src/lib/endings.js'
import { expectedWin, DEFAULT_K } from '../../server/src/rally-rating.js'
import { SAMPLE, POINTS, LATER, RALLIES, RATED, ENDED, STARRED } from '../src/lib/loop.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const icons = readFileSync(new URL('../../src/components/Icon.jsx', import.meta.url), 'utf8')
const iconPath = (key) => icons.match(new RegExp(`^  ${key}: '([^']+)',`, 'm'))?.[1]

check('all 18 keys, in the real order, with the real labels and outcomes',
  ENDINGS.map((e) => [e.key, e.label, e.outcome]),
  RALLY_ENDINGS.map((e) => [e.key, e.label, e.outcome]))
check('server-only endings marked as the real screen marks them', ENDINGS.map((e) => Boolean(e.by)), RALLY_ENDINGS.map((e) => Boolean(e.by)))
check('each key carries the umpire app’s own icon', ENDINGS.map((e) => e.path), ENDINGS.map((e) => iconPath(e.key)))

const rio = POINTS.filter(Boolean).length
check('the game before the rally is the sample score', [rio - 1, POINTS.length - rio], SAMPLE.before)
check('the rally itself is Rio’s point, and the game ends at the sample’s after score', [POINTS.at(-1), rio, POINTS.length - rio], [1, ...SAMPLE.after])
check('stars: 2 before, 3 after, the rally last', [STARRED.length - 1, STARRED.length, STARRED.at(-1)], [...SAMPLE.stars, POINTS.length])

check('the game ends 11-6 to Rio, after the 13 rallies up to the sample rally', [POINTS.length + LATER.length, POINTS.concat(LATER).filter(Boolean).length], [17, 11])
check('every rally has an ending, and the times only go forward', RALLIES.every((r, i) => ENDINGS.some((e) => e.key === r.key) && (i === 0 || r.at > RALLIES[i - 1].at)), true)
check('the sample rally is Rio’s dink winner, and the last rally a put-away', [RALLIES[12].by, RALLIES[12].key, RALLIES.at(-1).key], ['Rio', 'dink_winner', 'putaway'])

// Rio's phone: replay the 17 rallies through the real rule (singles: all of a rally's stake goes to who ended it).
let [rioPts, daniPts] = [RATED.rio, RATED.dani]
const ended = {}
RALLIES.forEach((r, i) => {
  const rioWon = Boolean(POINTS.concat(LATER)[i])
  const stake = DEFAULT_K * (1 - expectedWin(rioWon ? rioPts : daniPts, rioWon ? daniPts : rioPts))
  const change = rioWon ? stake : -stake
  rioPts += change
  daniPts -= change
  if (r.by === 'Rio') (ended[r.key] ??= []).push(change)
})
const sum = (key) => Math.round((ended[key] ?? []).reduce((a, b) => a + b, 0))
check('"cost you most": the net, 2 rallies, and its PPR', [ended.net.length, sum('net')], [ENDED.cost.rallies, ENDED.cost.ppr])
check('"won you most": dink winners, 3 rallies, and their PPR', [ended.dink_winner.length, sum('dink_winner')], [ENDED.won.rallies, ENDED.won.ppr])
check('no other ending has as many rallies as those two', Object.entries(ended).filter(([k, v]) => v.length >= 3 && k !== 'dink_winner').length, 0)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
