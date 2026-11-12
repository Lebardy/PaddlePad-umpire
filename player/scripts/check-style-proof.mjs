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
  styleTags,
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
check('a style of three or more', styleShareLine(10, 14), '10 players play this way')
check('a style of two', styleShareLine(2, 14), 'You and 1 other play this way')
check('a style of one', styleShareLine(1, 14), 'Nobody else plays this way yet')
check('no style size', styleShareLine(null, 14), 'Compared with similar players')
check('no group', styleShareLine(3, 0), null)

console.log('\na line for each word in the name')
const corner = (word, feature, out, inName = true) => ({ word, feature, out, inName })
check('words come in name order, unnamed corners left out',
  styleTags('Reliable Precise Dropper', [
    corner('Clean', 'error_to_winner_ratio', 'lower', false),
    corner('Precise', 'drop_efficiency_mean', 'higher'),
    corner('Dropper', 'drop_preference_rate_mean', 'higher'),
    corner('Reliable', 'drop_efficiency_std', 'lower'),
  ]).map((tag) => tag.word), ['Reliable', 'Precise', 'Dropper'])
check('Unpredictable reads by its measurement',
  [['aggression_std', 'Finishes points differently from one match to the next'], ['dink_error_rate_std', 'Has good days and bad days in the kitchen']]
    .map(([feature, says]) => styleTags('Unpredictable Driver', [corner('Unpredictable', feature, 'higher')])[0].says === says), [true, true])
check('the all-court noun gets a line with no corner of its own',
  styleTags('Steady All-Court Player', [corner('Steady', 'aggression_std', 'lower')]).map((tag) => tag.word), ['Steady', 'All-Court Player'])
check('a side with no word gets no row', styleTags('Driver', [corner('Driver', 'drop_efficiency_mean', 'lower')]), [])

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
