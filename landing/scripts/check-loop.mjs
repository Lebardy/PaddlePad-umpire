#!/usr/bin/env node
// ============================================================
// The See it loop: one sample rally, told the way the apps would tell it.
//
//   node landing/scripts/check-loop.mjs
//
// The sample must be possible in the real apps (a real ending, a legal
// score step, no more stars than the umpire may give) and must say it
// is a sample. The loop must never play by itself for someone who asked
// for reduced motion, or while it is off screen.
// ============================================================

import { RALLY_ENDINGS } from '../../server/src/rally-endings.js'
import { STEPS, SAMPLE, nextStep, prevStep, autoplays } from '../src/lib/loop.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('five steps in story order', STEPS.map((s) => s.id), ['tap', 'lands', 'star', 'reel', 'rating'])
check('every step has time to be read', STEPS.every((s) => s.ms >= 2500), true)
check('the ending is a real one, and a winner', RALLY_ENDINGS.find((e) => e.label === SAMPLE.ending)?.outcome, 'winner')
check('the winner gains exactly one point', [SAMPLE.after[0] - SAMPLE.before[0], SAMPLE.after[1] - SAMPLE.before[1]], [1, 0])
check('one more star, within the limit of 5', [SAMPLE.stars[1] - SAMPLE.stars[0], SAMPLE.stars[1] <= 5], [1, true])
check('the reel holds the starred rallies', SAMPLE.reel.of, SAMPLE.stars[1])
check('labelled as a sample', SAMPLE.label, 'Sample')
check('next and back wrap', [nextStep(4), prevStep(0), nextStep(1)], [0, 4, 2])
check('plays when on screen, not paused, motion allowed', autoplays({ reducedMotion: false, onScreen: true, paused: false }), true)
check('never plays by itself with reduced motion', autoplays({ reducedMotion: true, onScreen: true, paused: false }), false)
check('stops off screen', autoplays({ reducedMotion: false, onScreen: false, paused: false }), false)
check('stops when paused', autoplays({ reducedMotion: false, onScreen: true, paused: true }), false)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
