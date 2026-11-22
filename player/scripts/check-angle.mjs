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

const from = { seconds: [10, 40, 90], highlights: [{ start: 10 }, { start: 40 }, { start: 90 }] }
const to = { seconds: [12, null, 95], highlights: [{ start: 12 }, { start: 50 }, { start: 95 }] }

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

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('all ok')
