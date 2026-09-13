#!/usr/bin/env node
// ============================================================
// What was expected of a match.
//
//   node server/scripts/check-expectation.mjs
//
// The module is pure, so the arithmetic and the two rules that
// matter -- only what was knowable beforehand, and no number about
// anybody else -- are provable here with no database and no network.
// ============================================================

import {
  CLEAR_GAP, EVEN_WITHIN, expectationFor, sideRating,
} from '../src/expectation.js'

let pass = 0
let fail = 0

function check(label, actual, expected, why) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`) +
    `\n       ${why}`,
  )
}
const section = (title) => console.log(`\n${title}`)

// ============================================================
section('which side was favoured')
// ============================================================
{
  check('a clear gap the wrong way, and you won: an upset',
    expectationFor(40, 62, true),
    { expected: 'loss', margin: 'clear', upset: true },
    `22 points behind is past the ${CLEAR_GAP}-point mark, and the result went against it`)
  check('the same match, lost as expected',
    expectationFor(40, 62, false),
    { expected: 'loss', margin: 'clear', upset: false },
    'losing the one you were expected to lose is not an upset, and is not called one')
  check('a modest gap in your favour',
    expectationFor(58, 50, true),
    { expected: 'win', margin: 'slight', upset: false },
    `8 points is over ${EVEN_WITHIN} but under ${CLEAR_GAP}: favoured, not heavily`)
  check('a favourite who lost',
    expectationFor(58, 50, false),
    { expected: 'win', margin: 'slight', upset: true },
    'the flag is symmetric -- the app calls this one a slip rather than an upset')
}

// ============================================================
section('level is said as level')
// ============================================================
{
  check('inside the even band, nobody is named favourite',
    expectationFor(51, 49, false),
    { expected: 'even', margin: null, upset: false },
    `2 points apart is inside ${EVEN_WITHIN}; naming a favourite on that would be false precision`)
  check('and a level match can never be an upset',
    [expectationFor(51, 49, true).upset, expectationFor(51, 49, false).upset],
    [false, false],
    'a result that was a coin flip beforehand cannot have gone against expectation')
  check('exactly on the boundary counts as a gap',
    expectationFor(56, 50, false).expected, 'win',
    `${EVEN_WITHIN} points is the first gap wide enough to call, so the band is exclusive at the top`)
}

// ============================================================
section('a match nobody can call')
// ============================================================
{
  const scores = new Map([['a', 60], ['b', 40]])
  check('a side with an unrated player has no rating',
    sideRating(['a', 'unknown'], scores), null,
    'averaging the one rated half of a pair would describe a team that never played')
  check('and then there is no expectation at all',
    expectationFor(null, 50, true), null,
    'the page shows nothing rather than a hedge')
  check('a rated pair averages both of them',
    sideRating(['a', 'b'], scores), 50,
    '(60 + 40) / 2 -- singles is the same call with one player')
  check('a match stopped at a tie is not an upset either',
    expectationFor(40, 62, null),
    { expected: 'loss', margin: 'clear', upset: false },
    'there is no result to have gone against the expectation')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
