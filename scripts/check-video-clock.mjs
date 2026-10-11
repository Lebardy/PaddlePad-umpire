#!/usr/bin/env node
// ============================================================
// The Camera screen's small decisions (src/lib/videoClock.js).
//
//   node scripts/check-video-clock.mjs
// ============================================================

import { START_LATE_MS, beatAction, clockText, firstFrameAt, isWide, noteBeatTiming, pickBitrate, pickType } from '../src/lib/videoClock.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)

section("the server's clock, from the beats")
{
  // This phone is 3 s behind the server. A beat that took 400 ms, then one that took 100 ms, then a slow one.
  const first = noteBeatTiming(null, { sentAt: 1000, receivedAt: 1400, serverNow: 4200 })
  check('the first answer is taken', first, { offsetMs: 3000, roundTripMs: 400 })
  const better = noteBeatTiming(first, { sentAt: 3000, receivedAt: 3100, serverNow: 6060 })
  check('a faster answer replaces it', better, { offsetMs: 3010, roundTripMs: 100 })
  check('a slower one does not', noteBeatTiming(better, { sentAt: 5000, receivedAt: 5900, serverNow: 8700 }), better)
  check('an answer with no time is ignored', noteBeatTiming(better, { sentAt: 1, receivedAt: 2, serverNow: undefined }), better)
  check('so is a clock that ran backwards', noteBeatTiming(null, { sentAt: 10, receivedAt: 5, serverNow: 100 }), null)
}

section('when the first picture was taken')
{
  check('the recorder starts a quarter second late', START_LATE_MS, 250)
  check("in the server's time", firstFrameAt(10_000, { offsetMs: 3000, roundTripMs: 100 }), 12_750)
  check('with no beat answered yet, this phone\'s own clock', firstFrameAt(10_000, null), 9750)
}

section('what a beat means')
{
  check('waiting, nothing on court', beatAction(null, null), 'stay')
  check('waiting, a match has started', beatAction(null, 'm1'), 'start')
  check('waiting, the match was already filmed', beatAction(null, 'm1', true), 'stay')
  check('waiting, a match not yet filmed', beatAction(null, 'm2', false), 'start')
  check('filming, the same match goes on', beatAction('m1', 'm1'), 'stay')
  check('filming, the match is over', beatAction('m1', null), 'stop')
  check('filming, and a different match is named', beatAction('m1', 'm2'), 'stop')
}

section('picture and format')
{
  check('1080p gets 5 Mbit/s', pickBitrate(1920, 1080), 5_000_000)
  check('held upright it is still 1080p', pickBitrate(1080, 1920), 5_000_000)
  check('720p gets 2.5', pickBitrate(1280, 720), 2_500_000)
  check('a wide picture', isWide(1920, 1080), true)
  check('an upright one', isWide(1080, 1920), false)
  check('a square one is not wide', isWide(1000, 1000), false)
  check('the first MP4 type the browser can record', pickType((t) => t === 'video/mp4'), 'video/mp4')
  check('the most exact one when it can', pickType(() => true), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2')
  check('none when it can only record another format', pickType((t) => t.startsWith('video/webm')), null)
}

section('the timer')
{
  check('four minutes twelve', clockText(252_000), '04:12')
  check('just started', clockText(0), '00:00')
  check('past the hour', clockText(3_852_000), '1:04:12')
  check('never negative', clockText(-5), '00:00')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
