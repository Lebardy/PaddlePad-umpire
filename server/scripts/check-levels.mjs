#!/usr/bin/env node
// ============================================================
// Which level a player is in, from one run's notes.
//
//   node server/scripts/check-levels.mjs
// ============================================================

import { LADDER, levelForPlayer } from '../src/levels.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const TWO = [
  { name: 'Developing', groups: ['Group A', 'Group B'], players: 40, average: 1469.4, spread: 98.2 },
  { name: 'Advanced', groups: ['Group C'], players: 14, average: 1625.1, spread: 104.4, gapBelow: 155.7, neededBelow: 76.5 },
]

console.log('\nthe player in the upper level')
check('names the level, its ladder rank and its place tonight',
  levelForPlayer({ levels: TWO, skillGroup: 'Group C', rallyPoints: 1839.6 }),
  { name: 'Advanced', rank: 4, position: 2, of: 2, you: 1840,
    levels: [
      { name: 'Advanced', players: 14, average: 1625, spread: 104, mine: true },
      { name: 'Developing', players: 40, average: 1469, spread: 98, gapAbove: 156 },
    ] })

console.log('\na player in a joined level')
check('either group of the joined level finds it',
  levelForPlayer({ levels: TWO, skillGroup: 'Group B', rallyPoints: 1263 })?.name, 'Developing')
check('and the lower row is theirs',
  levelForPlayer({ levels: TWO, skillGroup: 'Group B', rallyPoints: 1263 })?.levels.map((l) => !!l.mine), [false, true])

console.log('\nnothing to show')
check('no levels in the run (an older run)', levelForPlayer({ levels: undefined, skillGroup: 'Group C', rallyPoints: 1 }), null)
check('one level', levelForPlayer({ levels: [TWO[0]], skillGroup: 'Group A', rallyPoints: 1 }), null)
check('the player is not in the run', levelForPlayer({ levels: TWO, skillGroup: null, rallyPoints: null }), null)
check('a group no level holds', levelForPlayer({ levels: TWO, skillGroup: 'Group Z', rallyPoints: 1 }), null)
check('a name off the ladder', levelForPlayer({ levels: [{ ...TWO[0], name: 'Group 4' }, TWO[1]], skillGroup: 'Group A', rallyPoints: 1 }), null)

console.log('\nthe ladder')
check('five names, lowest first', LADDER, ['Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert'])
check('rally points missing from an older payload read as null',
  levelForPlayer({ levels: TWO, skillGroup: 'Group C', rallyPoints: null })?.you, null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
