#!/usr/bin/env node
// ============================================================
// The playstyle step's wording for styles of every size.
//
//   node player/scripts/check-style-proof.mjs
//
// A style of one player is that player: the page talks about them
// directly. A style of two keeps its average hidden, because beside the
// player's own number it would give away the other player's. Three or
// more is unchanged.
// ============================================================

import {
  MEASURES,
  hiddenStyleNote,
  styleShareLine,
  swingBands,
  swingLine,
  traitLine,
  usualWords,
  verdictWay,
} from '../src/lib/styleProof.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

console.log('\nwho shares the style')
check('a style of three or more', styleShareLine(10, 14), '10 of 14 play this way')
check('a style of two', styleShareLine(2, 14), 'You and 1 other of 14 play this way')
check('a style of one', styleShareLine(1, 14), 'No one else in your group plays this way yet')
check('no style size', styleShareLine(null, 14), 'Compared with 14 in your group')
check('no group', styleShareLine(3, 0), null)

console.log('\nwhich way the sentence points')
check('three or more: the style against the group',
  verdictWay({ you: 0.1, style: 0.3, group: 0.2, direction: 'above' }, 7), 'higher')
check('two: never, the style average is hidden',
  verdictWay({ you: 0.5, style: null, group: 0.2, direction: 'above' }, 2), null)
check('one: the player against the group, when it agrees with the word',
  [verdictWay({ you: 0.36, style: null, group: 0.24, direction: 'above' }, 1),
    verdictWay({ you: 0.1, style: null, group: 0.24, direction: 'below' }, 1)], ['higher', 'lower'])
check('one: nothing, when the raw numbers point against the word',
  verdictWay({ you: 0.36, style: null, group: 0.24, direction: 'below' }, 1), null)
check('one: nothing recorded, nothing said',
  verdictWay({ you: null, style: null, group: 0.24, direction: 'above' }, 1), null)

console.log('\nthe note under a style of two')
check('only a style of two gets it', [hiddenStyleNote(1), hiddenStyleNote(3)], [null, null])
check('and it says why', hiddenStyleNote(2),
  'Your style’s average is hidden: with 2 players it would reveal the other’s numbers.')

console.log('\nthe short line under each trait')
const row = (feature, style, group, you = style) => ({ feature, you, style, group, direction: style > group ? 'above' : 'below' })
check('a style of several, lower', traitLine(row('error_to_winner_ratio', 0.89, 1.09), 19), 'Your style: lower than your group')
check('a style of several, higher', traitLine(row('drop_preference_rate_mean', 0.55, 0.49), 19), 'Your style: higher than your group')
check('a style of one is about the player', traitLine({ ...row('error_to_winner_ratio', null, 1.09, 0.8), direction: 'below' }, 1), 'You: lower than your group')
check('no line when there is no way to point', traitLine(row('drop_preference_rate_mean', null, 0.49, 0.6), 2), null)
check('no line for an unknown measure', traitLine(row('made_up', 0.5, 0.4), 5), null)
check('every measure has a label and a way to read its number',
  Object.entries(MEASURES).filter(([, m]) => typeof m.label !== 'string' || !m.as || !m.better).map(([f]) => f), [])
check('no label runs past one line on a phone', Object.entries(MEASURES).filter(([, m]) => m.label.length > 50).map(([f, m]) => `${f}: ${m.label.length}`), [])

console.log('\nswing rows say what a player usually does')
const steady = { feature: 'winner_rate_std', you: 0.06, style: 0.07, group: 0.09, center: { you: 0.48, style: 0.45, group: 0.42 } }
const b = swingBands(steady, MEASURES.winner_rate_std)
check('per 10 minutes, rounded to whole shots', b.bands.map((x) => x.words), ['4 to 5', '4 to 5', '3 to 5'])
check('you first, then your style, then your group', b.bands.map((x) => x.who), ['you', 'your style', 'your group'])
check('the scale is whole numbers around every band', [b.lo, b.hi], [3, 6])
const drops = { feature: 'drop_efficiency_std', you: 0.06, style: null, group: 0.11, center: { you: 0.54, style: null, group: 0.5 } }
const d = swingBands(drops, MEASURES.drop_efficiency_std)
check('shares in whole percents, and no style band without a style average', d.bands.map((x) => x.words), ['48% to 60%', '39% to 61%'])
check('share scales snap to tens', [d.lo, d.hi], [30, 70])
check('a band never goes below zero', swingBands({ ...steady, you: 0.6, center: { ...steady.center, you: 0.2 } }, MEASURES.winner_rate_std).bands[0].low, 0)
check('no center, no bands (an older run)', swingBands({ ...steady, center: null }, MEASURES.winner_rate_std), null)
check('a band that rounds to one number says "about"', usualWords(4.6, 4.9, true), 'about 5')
check('the line, for a style', [swingLine('lower', 3), swingLine('higher', 3)], ['Your style: steadier than your group', 'Your style: swings more than your group'])
check('the line, for a style of one', [swingLine('lower', 1), swingLine('higher', 1)], ['You: steadier than your group', 'You: swing more than your group'])
// The line compares two bands; when whole numbers would make them read alike, the row shows one decimal.
const tie = { feature: 'winner_rate_std', you: 0.06, style: 0.07, group: 0.08, center: { you: 0.48, style: 0.45, group: 0.44 } }
check('a row whose compared bands would tie shows one decimal, on every band', swingBands(tie, MEASURES.winner_rate_std, 'your style').bands.map((x) => x.words), ['4.2 to 5.4', '3.8 to 5.2', '3.6 to 5.2'])
check('a row that does not tie stays whole', swingBands(steady, MEASURES.winner_rate_std, 'your style').bands.map((x) => x.words), ['4 to 5', '4 to 5', '3 to 5'])
check('no line, no decimals', swingBands(tie, MEASURES.winner_rate_std, null).bands.map((x) => x.words), ['4 to 5', '4 to 5', '4 to 5'])
const pctTie = { feature: 'drop_efficiency_std', you: 0.06, style: 0.09, group: 0.088, center: { you: 0.54, style: 0.45, group: 0.452 } }
check('a share row ties the same way, in tenths of a percent', swingBands(pctTie, MEASURES.drop_efficiency_std, 'your style').bands.map((x) => x.words), ['48.0% to 60.0%', '36.0% to 54.0%', '36.4% to 54.0%'])
const oneTie = { feature: 'winner_rate_std', you: 0.06, style: null, group: 0.07, center: { you: 0.45, style: null, group: 0.44 } }
check('a style of one compares you with the group', swingBands(oneTie, MEASURES.winner_rate_std, 'you').bands.map((x) => x.words), ['3.9 to 5.1', '3.7 to 5.1'])
const flat = { feature: 'winner_rate_std', you: 0, style: null, group: 0, center: { you: 0, style: null, group: 0 } }
check('every band 0 to 0 still has a scale', (({ lo, hi }) => [lo, hi])(swingBands(flat, MEASURES.winner_rate_std)), [0, 1])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
