#!/usr/bin/env node
// ============================================================
// Where each highlight starts and stops in a match's video. No
// database, no network.
//
//   node server/scripts/check-highlights.mjs
//
// A rally's stamp is when it ENDED. A highlight plays the last 15 s
// before that end (never reaching back past the rally before it) and
// 1 s after, inside the video.
// ============================================================

import { highlightClips } from '../src/video-times.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const T = Date.parse('2026-10-23T10:00:00Z')
// First picture 4 s after the start; rallies end at 20, 35 and 50 s.
const base = {
  startedAtMs: T, offsetMs: 0, firstFrameAtMs: T + 4000, durationMs: 120_000,
  rallies: [{ id: 'a', atMs: T + 20_000 }, { id: 'b', atMs: T + 35_000 }, { id: 'c', atMs: T + 50_000 }],
}
const clips = (picked, over = {}) => highlightClips({ ...base, ...over, picked })

check('a rally plays from where the one before ended to 1 s after its own end', clips(['b']), [{ id: 'b', index: 1, start: 16, end: 32 }])
check('the first rally starts with the match, never before the video', clips(['a']), [{ id: 'a', index: 0, start: 1, end: 17 }])
check('a long gap before a rally is cut to its last 15 s',
  clips(['c'], { rallies: [base.rallies[0], { id: 'c', atMs: T + 80_000 }] }), [{ id: 'c', index: 1, start: 61, end: 77 }])
check('the 1 s after stops at the end of the video', clips(['c'], { durationMs: 46_500 }), [{ id: 'c', index: 2, start: 31, end: 46.5 }])
check('a rally that ended before filming began is left out',
  clips(['x'], { rallies: [{ id: 'x', atMs: T + 2000 }, ...base.rallies] }), [])
check('a rally that began after the video ended is left out', clips(['c'], { durationMs: 20_000 }), [])
check('picks come back in play order', clips(['c', 'a']).map((c) => c.id), ['a', 'c'])
check('an id that is not a rally of the match is ignored', clips(['nope', 'b']).map((c) => c.id), ['b'])
check('nothing picked, nothing to play', clips([]), [])
check('Fix timing moves every clip with the video', clips(['b'], { firstFrameAtMs: T + 9000 }), [{ id: 'b', index: 1, start: 11, end: 27 }])
check("the tablet's clock offset is applied", clips(['b'], { offsetMs: 3000 }), [{ id: 'b', index: 1, start: 19, end: 35 }])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
