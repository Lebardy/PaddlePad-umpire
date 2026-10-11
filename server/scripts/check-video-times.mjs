#!/usr/bin/env node
// ============================================================
// Where each rally is in a match's video. No database, no network.
//
//   node server/scripts/check-video-times.mjs
//
// The tablet stamps each rally with its own clock when the umpire logs
// it, which is when the rally ENDED. The phone says when its first
// picture was taken, in the server's time. So:
//   a rally's end, in the server's time = its stamp + the tablet's offset
//   a rally starts where the one before it ended (the match's start for
//   the first), but a jump never lands more than 40 s before the rally's
//   own end, so a long break between rallies is skipped.
// ============================================================

import { MAX_LEAD_MS, clockOffsetMs, firstFrameFromLineUp, rallySeconds } from '../src/video-times.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)
const T = Date.parse('2026-10-11T10:00:00Z')

section("the tablet's clock")
{
  check('a tablet 3 s behind the server', clockOffsetMs(T, T - 3000), 3000)
  check('a tablet 2 s ahead', clockOffsetMs(T, T + 2000), -2000)
  check('fractions are rounded', clockOffsetMs(T + 0.6, T), 1)
  check('no clock sent', clockOffsetMs(T, undefined), null)
  check('not a number', clockOffsetMs(T, Number('abc')), null)
  check('a clock more than a day out is not believed', clockOffsetMs(T, T - 25 * 3600 * 1000), null)
  check('exactly a day out still is', clockOffsetMs(T, T - 24 * 3600 * 1000), 86400000)
}

section('each rally in the video')
{
  // Filming began 4 s after the match started; rallies logged at 20 s, 50 s, 2 min 30 s and 3 min after the start.
  const base = { startedAtMs: T, offsetMs: 0, firstFrameAtMs: T + 4000, durationMs: 200_000 }
  const rallies = [{ atMs: T + 20_000 }, { atMs: T + 50_000 }, { atMs: T + 150_000 }, { atMs: T + 180_000 }]
  check('the cap is 40 s', MAX_LEAD_MS, 40000)
  check('first rally starts before the video does, so it plays from 0; then each from the end of the one before; a long break is cut to 40 s',
    rallySeconds({ ...base, rallies }), [0, 16, 106, 146])
  check("the tablet's offset moves every rally", rallySeconds({ ...base, offsetMs: 2000, rallies }), [0, 18, 108, 148])
  check('a missing offset counts as none', rallySeconds({ ...base, offsetMs: null, rallies }), [0, 16, 106, 146])
  check('to a tenth of a second', rallySeconds({ ...base, firstFrameAtMs: T + 4050, rallies: rallies.slice(0, 2) }), [0, 16])
  check('rounded, not cut', rallySeconds({ ...base, firstFrameAtMs: T + 3940, rallies: rallies.slice(0, 2) }), [0, 16.1])
  check('a rally that ended before filming began has no second',
    rallySeconds({ ...base, firstFrameAtMs: T + 30_000, rallies }), [null, 0, 80, 120])
  check('a rally that began after the video ended has none either',
    rallySeconds({ ...base, durationMs: 100_000, rallies }), [0, 16, null, null])
  check('a rally cut off by the end of the video still starts inside it',
    rallySeconds({ ...base, durationMs: 120_000, rallies }), [0, 16, 106, null])
  check('no rallies', rallySeconds({ ...base, rallies: [] }), [])
}

section('fix timing')
{
  // The umpire paused at video second 31.5 and said "this is where the rally logged at T+50 s ended".
  check('the first picture is put that far before the rally', firstFrameFromLineUp({ rallyAtMs: T + 50_000, offsetMs: 0, videoSecond: 31.5 }), T + 18_500)
  check("with the tablet's offset", firstFrameFromLineUp({ rallyAtMs: T + 50_000, offsetMs: -2000, videoSecond: 31.5 }), T + 16_500)
  check('a missing offset counts as none', firstFrameFromLineUp({ rallyAtMs: T + 50_000, offsetMs: null, videoSecond: 31.5 }), T + 18_500)
  const first = firstFrameFromLineUp({ rallyAtMs: T + 50_000, offsetMs: 0, videoSecond: 31.5 })
  check('and that rally then starts where the one before it ended',
    rallySeconds({ startedAtMs: T, offsetMs: 0, firstFrameAtMs: first, durationMs: 200_000, rallies: [{ atMs: T + 20_000 }, { atMs: T + 50_000 }, { atMs: T + 60_000 }] }),
    [0, 1.5, 31.5])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
