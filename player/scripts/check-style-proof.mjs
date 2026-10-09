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
  traitLine,
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
check('a style of one says nobody else has it', styleShareLine(1, 26), 'No one else among the 26 players at your level has this style yet.')
check('a style of two says one other player', styleShareLine(2, 26), 'You and 1 other of the 26 players at your level share this style.')
check('three or more says how many of the group', styleShareLine(19, 26), '19 of the 26 players at your level share this style.')
check('no style size: only who it is compared with', styleShareLine(0, 26), 'Compared with the 26 players at your level.')
check('no group, no line', [styleShareLine(3, 0), styleShareLine(3, undefined)], [null, null])

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
