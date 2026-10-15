#!/usr/bin/env node
// ============================================================
// Which level a player is on, from one run's levels and today's
// ratings.
//
//   node server/scripts/check-levels.mjs
// ============================================================

import { LADDER, levelForPlayer, levelNamer } from '../src/levels.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

// Staging's run of 2026-10-14 as recorded, lowest first. Only the names and
// averages are read; what is shown comes from today's ratings.
const TWO = [
  { name: 'Developing', groups: ['Group A', 'Group B'], players: 40, average: 1469.0, spread: 96.6 },
  { name: 'Advanced', groups: ['Group C'], players: 14, average: 1625.1, spread: 123.2, gapBelow: 156.1, neededBelow: 72.6 },
]
// Made-up current ratings for that run's players.
const TODAY = [1400, 1450, 1500, 1600, 1700]

console.log('\nthe level follows the rating (staging: line 1547.05)')
const onTwo = (points) => levelForPlayer({ levels: TWO, points, runPoints: TODAY })?.name
check('1483 is Developing', onTwo(1483), 'Developing')
check('1611 is Advanced', onTwo(1611), 'Advanced')
check('1546.8, just under the line, is Developing', onTwo(1546.8), 'Developing')
check('1549.5, just over it, is Advanced', onTwo(1549.5), 'Advanced')

console.log('\nthe whole level, highest first')
check('names the level, its ladder rank and its place tonight, numbers from today\'s ratings',
  levelForPlayer({ levels: TWO, points: 1600, runPoints: TODAY }),
  { name: 'Advanced', rank: 4, position: 2, of: 2, you: 1600,
    levels: [
      { name: 'Advanced', players: 2, average: 1650, spread: 71, mine: true },
      { name: 'Developing', players: 3, average: 1450, spread: 50, gapAbove: 200 },
    ] })
check('a 1483 player\'s row is the lower one',
  levelForPlayer({ levels: TWO, points: 1483, runPoints: TODAY })?.levels.map((l) => !!l.mine), [false, true])
check('you is the current rating, rounded',
  levelForPlayer({ levels: TWO, points: 1610.6, runPoints: TODAY })?.you, 1611)

console.log('\nthe numbers come from the placed ratings')
check('the spread is the sample one (n - 1): 50 for 1400, 1450, 1500, not 41',
  levelForPlayer({ levels: TWO, points: 1450, runPoints: TODAY })?.levels[1].spread, 50)
check('a level of one has spread 0',
  levelForPlayer({ levels: TWO, points: 1611, runPoints: [1400, 1450, 1611] })?.levels[0],
  { name: 'Advanced', players: 1, average: 1611, spread: 0, mine: true })
check('run players with no current rating are not counted',
  levelForPlayer({ levels: TWO, points: 1600, runPoints: [1400, undefined, 1500, 1600, undefined, 1700] })?.levels.map((l) => l.players),
  [2, 2])
// Averages 1625.33 and 1469.67: shown 1625 and 1470, so 155 apart, not 156.
const shown = levelForPlayer({ levels: TWO, points: 1625, runPoints: [1469, 1470, 1470, 1625, 1625, 1626] })?.levels
check('the gap is the difference of the two shown averages',
  [shown?.[0].average, shown?.[1].average, shown?.[1].gapAbove], [1625, 1470, 155])

console.log('\nthree levels, two lines (1450 and 1575)')
const THREE = [
  { name: 'Developing', average: 1400 },
  { name: 'Intermediate', average: 1500 },
  { name: 'Advanced', average: 1650 },
]
const SPREAD_OUT = [1350, 1450, 1500, 1575, 1700]
const onThree = (points) => levelForPlayer({ levels: THREE, points, runPoints: SPREAD_OUT })
check('1449, 1450, 1574 and 1575 sit either side of the two lines',
  [1449, 1450, 1574, 1575].map((points) => onThree(points)?.name), ['Developing', 'Intermediate', 'Intermediate', 'Advanced'])
check('a rating exactly on a line goes up, run players too',
  onThree(1450)?.levels.map((l) => l.players), [2, 2, 1])
const positions = Array.from({ length: 701 }, (_, i) => onThree(1200 + i)?.position)
check('from 1200 to 1900 in order, the level never steps down',
  positions.every((position, i) => i === 0 || position >= positions[i - 1]), true)
check('and it passes through all three', [...new Set(positions)], [1, 2, 3])

console.log('\nnothing to show')
check('no levels in the run (an older run)', levelForPlayer({ levels: undefined, points: 1500, runPoints: TODAY }), null)
check('one level', levelForPlayer({ levels: [TWO[0]], points: 1500, runPoints: TODAY }), null)
check('a player with no current rating', levelForPlayer({ levels: TWO, points: undefined, runPoints: TODAY }), null)
check('a level left with nobody', levelForPlayer({ levels: TWO, points: 1400, runPoints: [1400, 1450] }), null)
check('a name off the ladder',
  levelForPlayer({ levels: [{ ...TWO[0], name: 'Group 4' }, TWO[1]], points: 1400, runPoints: TODAY }), null)

console.log('\nthe ladder')
check('five names, lowest first', LADDER, ['Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert'])

console.log('\nthe level name for any rating (levelNamer)')
const namer = levelNamer({ levels: TWO, runPoints: [1400, 1450, 1500, 1600, 1700] })
check('1,483 is Developing', namer(1483), 'Developing')
check('1,611 is Advanced', namer(1611), 'Advanced')
check('on the line goes up', namer(1547.05), 'Advanced')
check('no rating, no level', namer(undefined), null)
check('a level left empty: nothing to show', levelNamer({ levels: TWO, runPoints: [1400, 1450] }), null)
check('fewer than two levels', levelNamer({ levels: TWO.slice(0, 1), runPoints: [1400] }), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
