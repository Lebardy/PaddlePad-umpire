#!/usr/bin/env node
// The level plate's arithmetic and words.  node player/scripts/check-levels.mjs
import { LADDER_RANK, at, levelScale, plateLabel } from '../src/lib/levels.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const LEVEL = { name: 'Advanced', rank: 4, position: 2, of: 2, you: 1840,
  levels: [{ name: 'Advanced', players: 14, average: 1625, spread: 104, mine: true },
           { name: 'Developing', players: 40, average: 1469, spread: 98, gapAbove: 156 }] }

const scale = levelScale(LEVEL)
check('the scale holds every band and the player, with a little room', scale.lo < 1371 && scale.hi > 1840, true)
check('positions run 0 to 100 across the scale', [Math.round(at(scale, scale.lo)), Math.round(at(scale, scale.hi))], [0, 100])
check('a player with no points still gets a scale from the bands',
  levelScale({ ...LEVEL, you: null }).hi > 1729, true)
check('the label says the name and the place among tonight\'s levels',
  plateLabel(LEVEL), 'Your level: Advanced, 2 of 2. Show the levels.')
check('Developing is rung 2 of the ladder, whatever the night', LADDER_RANK.Developing, 2)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
