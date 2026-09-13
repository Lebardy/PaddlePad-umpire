#!/usr/bin/env node
// ============================================================
// The skill group ladder follows the order the pipeline named it in.
//
//   node server/scripts/check-group-ladder.mjs
// ============================================================

import { orderLadder } from '../src/group-ladder.js'

let pass = 0
let fail = 0
function check(label, ok, why) {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}\n       ${why}`)
}

const names = (ladder) => ladder.map((g) => g.name).join(' < ')
const byScore = [{ name: 'Performance Group 3' }, { name: 'Performance Group 1' }, { name: 'Performance Group 2' }]

const ordered = orderLadder(byScore, ['Performance Group 1', 'Performance Group 2', 'Performance Group 3'])
check('a recorded order wins over the old score order',
  names(ordered) === 'Performance Group 1 < Performance Group 2 < Performance Group 3', names(ordered))

check('an older run with no recorded order keeps the score order',
  names(orderLadder(byScore, undefined)) === names(byScore), names(orderLadder(byScore, undefined)))

const partial = orderLadder(byScore, ['Performance Group 1', 'Performance Group 2'])
check('an order that misses a group is not trusted',
  names(partial) === names(byScore), names(partial))

const extra = orderLadder(byScore, ['Performance Group 1', 'Old Group', 'Performance Group 2', 'Performance Group 3'])
check('names in the order that no longer exist are ignored',
  names(extra) === 'Performance Group 1 < Performance Group 2 < Performance Group 3', names(extra))

orderLadder(byScore, ['Performance Group 1', 'Performance Group 2', 'Performance Group 3'])
check('the ladder passed in is not reordered in place',
  byScore[0].name === 'Performance Group 3', names(byScore))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
