#!/usr/bin/env node
// What the Highlights reel does as the video plays. No browser.
//   node player/scripts/check-reel.mjs
import { reelStep } from '../src/lib/reel.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const clips = [{ start: 16, end: 32 }, { start: 61, end: 77 }]

check('inside a clip it keeps playing', reelStep(clips, 0, 20), { index: 0 })
check('at the end of a clip it jumps to the next', reelStep(clips, 0, 32), { index: 1, seek: 61 })
check('past the end too (a late time update)', reelStep(clips, 0, 40), { index: 1, seek: 61 })
check('after the last clip it stops', reelStep(clips, 1, 77), { done: true })
check('no clip there, it stops', reelStep(clips, 5, 0), { done: true })
check('no clips at all, it stops', reelStep([], 0, 0), { done: true })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
