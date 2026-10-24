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
import { SAMPLE, POINTS, STARRED } from '../src/lib/loop.js'

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
