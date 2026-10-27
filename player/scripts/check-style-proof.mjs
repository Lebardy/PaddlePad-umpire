#!/usr/bin/env node
// ============================================================
// How many share a style, and how each corner's number reads.
//
//   node player/scripts/check-style-proof.mjs
// ============================================================

import {
  MEASURES,
  lowerIsMore,
  metaLine,
  shownNumber,
  styleShareLine,
} from '../src/lib/styleProof.js'
import { hasStyle } from '../src/lib/fingerprint.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

console.log('\nwho shares the style')
check('a style of three or more', styleShareLine(10, 14), '10 play this way')
check('a style of two', styleShareLine(2, 14), 'You and 1 other play this way')
check('a style of one', styleShareLine(1, 14), 'Nobody else plays this way yet')
check('no style size', styleShareLine(null, 14), 'Compared with similar players')
check('no group', styleShareLine(3, 0), null)

console.log('\nthe table agrees with its words')
const driver = { feature: 'drop_preference_rate_mean', out: 'lower' }
const dropper = { feature: 'drop_preference_rate_mean', out: 'higher' }
const clean = { feature: 'error_to_winner_ratio', out: 'lower' }
check('a Driver shows drives, not drops', shownNumber(0.4, driver), 0.6)
check('a Power Player shows away from the net', shownNumber(0.25, { feature: 'net_game_preference_rate_mean', out: 'lower' }), 0.75)
check('a Dropper shows drops as they are', shownNumber(0.4, dropper), 0.4)
check('Clean keeps its ratio', shownNumber(0.88, clean), 0.88)
check('nothing recorded stays nothing', shownNumber(null, driver), null)
check('lower-is-more cue on Clean and the swings, not on Driver or a high word',
  [clean, { feature: 'winner_rate_std', out: 'lower' }, driver, dropper].map(lowerIsMore), [true, true, false, false])

console.log('\nthe level-up line')
check('another style is named', metaLine({ style: 'Reliable Precise Dropper' }, 'Steady Driver', 'Developing / Lower-Performance'),
  { before: 'At the next level up, many play as ', style: 'Reliable Precise Droppers', after: '.' })
check('the same style is said plainly', metaLine({ style: 'A' }, 'A', null), { before: 'Your style is the most common one level up.' })
check('no meta, no line', metaLine(null, 'A', null), null)

console.log('\nthe style shape')
check('one corner with a style number is enough', hasStyle([{ style: null }, { style: 0.4 }]), true)
check('no style numbers, no shape', hasStyle([{ style: null }, {}]), false)

console.log('\nthe measures')
check('every measure says how its number reads', Object.values(MEASURES).every((m) => ['percent', 'ratio', 'swing-percent', 'swing-per10'].includes(m.as)), true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
