#!/usr/bin/env node
// Where the other camera's video picks up when the player switches. No browser.
//   node player/scripts/check-angle.mjs
import { carryPlace } from '../src/lib/angle.js'

let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const from = { seconds: [10, 40, 90], highlights: [{ start: 10, rally: 'r1' }, { start: 40, rally: 'r2' }, { start: 90, rally: 'r3' }] }
const to = { seconds: [12, null, 95], highlights: [{ start: 12, rally: 'r1' }, { start: 50, rally: 'r2' }, { start: 95, rally: 'r3' }] }

check('a selected point goes to its second in the other video',
  carryPlace({ from, to, selected: 2, reelIndex: null }), { second: 95, reelIndex: null })
check('a selected point the other video does not show falls back to nothing',
  carryPlace({ from, to, selected: 1, reelIndex: null }), { second: null, reelIndex: null })
check('a point it does not show, with a reel running, falls back to the reel',
  carryPlace({ from, to, selected: 1, reelIndex: 1 }), { second: 50, reelIndex: 1 })
check('a reel at index 2 carries on from the same highlight',
  carryPlace({ from, to, selected: null, reelIndex: 2 }), { second: 95, reelIndex: 2 })
check('nothing selected, no reel: start where it starts',
  carryPlace({ from, to, selected: null, reelIndex: null }), { second: null, reelIndex: null })
check('a reel index the other video has no highlight for is dropped',
  carryPlace({ from, to: { seconds: [], highlights: [] }, selected: null, reelIndex: 2 }), { second: null, reelIndex: null })

// Stars r1 and r3; B's phone started late and holds only r3.
const A = { seconds: [], highlights: [{ start: 10, rally: 'r1' }, { start: 90, rally: 'r3' }] }
const B = { seconds: [], highlights: [{ start: 5, rally: 'r3' }] }
check('late B: reel on B at r3, switch to A, plays index 1',
  carryPlace({ from: B, to: A, selected: null, reelIndex: 0 }), { second: 90, reelIndex: 1 })
check('late B: reel on A at r3, switch to B, plays index 0',
  carryPlace({ from: A, to: B, selected: null, reelIndex: 1 }), { second: 5, reelIndex: 0 })
check('late B: reel on A at r1 (B lacks it), switch to B, falls to the next star r3',
  carryPlace({ from: A, to: B, selected: null, reelIndex: 0 }), { second: 5, reelIndex: 0 })
check('no star after it on the other camera: no reel',
  carryPlace({ from: { highlights: [{ start: 1, rally: 'r1' }] }, to: B, selected: null, reelIndex: 0 }), { second: null, reelIndex: null })

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('all ok')
