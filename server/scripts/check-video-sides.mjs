#!/usr/bin/env node
// Which video row a claim looks at, and which video a viewer sees first (src/video-sides.js).
//   node server/scripts/check-video-sides.mjs
import { heldFor, orderVideos, sideOf } from '../src/video-sides.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const match = { team_a: ['a1', 'a2'], team_b: ['b1', 'b2'] }
check('a player on side A', sideOf(match, 'a2'), 'A')
check('a player on side B', sideOf(match, 'b1'), 'B')
check('someone not in the match', sideOf(match, 'x'), null)
check('singles', sideOf({ team_a: ['a1'], team_b: ['b1'] }, 'b1'), 'B')

const facility = { id: 'f', source: 'facility', side: null, state: 'ready' }
const rowA = { id: 'ra', source: 'player', side: 'A', state: 'ready' }
const rowB = { id: 'rb', source: 'player', side: 'B', state: 'ready' }
const filmingB = { ...rowB, state: 'filming' }
const ids = (pair) => pair.map((r) => r?.id ?? null)

check('a claim on side B, nothing there', heldFor([], 'B'), null)
check('a claim on side B looks only at B', heldFor([rowA], 'B'), null)
check('a claim on side B finds B', heldFor([rowA, rowB], 'B')?.id, 'rb')
check('the facility row wins over any side', heldFor([rowB, facility], 'B')?.id, 'f')

check('a side-A player sees A first, then B', ids(orderVideos([rowB, rowA], 'A')), ['ra', 'rb'])
check('a side-B player sees B first, then A', ids(orderVideos([rowA, rowB], 'B')), ['rb', 'ra'])
check('only the other side filmed: that one, no switch', ids(orderVideos([rowA], 'B')), ['ra', null])
check('umpire/admin: A before B', ids(orderVideos([rowB, rowA], null)), ['ra', 'rb'])
check('umpire/admin: B alone', ids(orderVideos([rowB], null)), ['rb', null])
check('a facility video comes first for everyone', ids(orderVideos([facility], 'B')), ['f', null])
check('a video still filming does not count', ids(orderVideos([rowA, filmingB], 'B')), ['ra', null])
check('nothing ready', ids(orderVideos([filmingB], 'B')), [null, null])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
