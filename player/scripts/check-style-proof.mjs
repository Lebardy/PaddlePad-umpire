#!/usr/bin/env node
// ============================================================
// How many share a style, and how each corner's number reads.
//
//   node player/scripts/check-style-proof.mjs
// ============================================================

import {
  MEASURES,
  styleShareLine,
} from '../src/lib/styleProof.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

console.log('\nwho shares the style')
check('a style of three or more', styleShareLine(10, 14), '10 play this way')
check('a style of two', styleShareLine(2, 14), 'You and 1 other play this way')
check('a style of one', styleShareLine(1, 14), 'No similar player plays this way yet')
check('no style size', styleShareLine(null, 14), 'Compared with similar players')
check('no group', styleShareLine(3, 0), null)

console.log('\nthe measures')
check('every measure says how its number reads', Object.entries(MEASURES).filter(([, m]) => !m.as).map(([f]) => f), [])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
