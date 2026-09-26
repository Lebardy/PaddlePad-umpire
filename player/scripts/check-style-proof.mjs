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
  aboutYou,
  hiddenStyleNote,
  styleShareLine,
  verdictSubject,
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
check('a style of one says nobody else has it', styleShareLine(1), 'no one else has your style yet')
check('a style of two says one other player', styleShareLine(2), 'you and 1 other player share your style')
check('three or more reads as before', styleShareLine(7), '7 of them, you included, share your style')
check('no size, no line', [styleShareLine(0), styleShareLine(undefined)], [null, null])

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

console.log('\nwho the sentence is about')
check('one: you', verdictSubject(1), 'you')
check('otherwise: players with your style', [verdictSubject(2), verdictSubject(9)], ['players with your style', 'players with your style'])
check('said about the player, every measure reads in the second person',
  Object.entries(MEASURES).flatMap(([feature, m]) => ['higher', 'lower'].map((way) => [feature, aboutYou(m.says(way))]))
    .filter(([, text]) => /\b(their|they|them)\b/.test(text)), [])
check('for example',
  [aboutYou(MEASURES.aggression_std.says('higher')), aboutYou(MEASURES.winner_rate_std.says('lower')),
    aboutYou(MEASURES.error_to_winner_ratio.says('lower'))],
  ['change more from match to match in how many of your finishes are winners',
    'change less from match to match in how many winning shots you hit',
    'make fewer mistakes for every winning shot'])

console.log('\nthe note under a style of two')
check('only a style of two gets it', [hiddenStyleNote(1), hiddenStyleNote(3)], [null, null])
check('and it says why', hiddenStyleNote(2),
  'Your style has just 2 players, so its average isn’t shown: it would give away the other player’s numbers.')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
