#!/usr/bin/env node
// ============================================================
// The playstyle step's wording for styles of every size.
//
//   node player/scripts/check-style-proof.mjs
//
// A style of one player is that player: the page talks about them
// directly. A style of two keeps its average hidden, because beside the
// player's own number it would give away the other player's. Three or
// more is unchanged.
// ============================================================

import {
  MEASURES,
  hiddenStyleNote,
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

console.log('\nthe note under a style of two')
check('only a style of two gets it', [hiddenStyleNote(1), hiddenStyleNote(3)], [null, null])
check('and it says why', hiddenStyleNote(2),
  'Your style’s average is hidden: with 2 players it would reveal the other’s numbers.')

console.log('\nthe measures')
check('every measure has a label and a way to read its number',
  Object.entries(MEASURES).filter(([, m]) => typeof m.label !== 'string' || !m.as || !m.better).map(([f]) => f), [])
check('no label runs past one line on a phone', Object.entries(MEASURES).filter(([, m]) => m.label.length > 50).map(([f, m]) => `${f}: ${m.label.length}`), [])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
