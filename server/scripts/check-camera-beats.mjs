#!/usr/bin/env node
// ============================================================
// Which camera is alive. No database, no network.
//
//   node server/scripts/check-camera-beats.mjs
//
// A Camera screen says "I am here" every 2 seconds. The scoring
// tablet's icon shows what the server last heard, and "no camera" once
// 10 seconds have gone by with nothing.
// ============================================================

import { cameraStatus, forgetBeats, noteBeat } from '../src/camera-beats.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}, got ${actual}`}`)
}
const NOW = 1_000_000

forgetBeats()
check('nobody has said anything', cameraStatus('u1', NOW), 'none')
noteBeat('u1', 'ready', NOW)
check('a waiting camera is ready', cameraStatus('u1', NOW + 1000), 'ready')
check("another umpire's camera is not this one's", cameraStatus('u2', NOW + 1000), 'none')
noteBeat('u1', 'filming', NOW + 2000)
check('a filming camera is filming', cameraStatus('u1', NOW + 3000), 'filming')
noteBeat('u1', 'sending', NOW + 4000)
check('a camera that is sending is ready for the next match', cameraStatus('u1', NOW + 5000), 'ready')
check('ten seconds of silence is still a camera', cameraStatus('u1', NOW + 14_000), 'ready')
check('a moment more is not', cameraStatus('u1', NOW + 14_001), 'none')
noteBeat('u1', 'filming', NOW + 20_000)
forgetBeats()
check('forgetting empties it', cameraStatus('u1', NOW + 20_001), 'none')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
