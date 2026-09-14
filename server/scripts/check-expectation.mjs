#!/usr/bin/env node
// ============================================================
// What was expected of a match, from rally points.
//
//   node server/scripts/check-expectation.mjs
//
// The replay gives each side's chance of winning a rally before the
// match. This checks how that chance becomes words: even, a slight
// favourite or a clear one, and when the result was an upset. Pure, so
// no database and no network.
// ============================================================

import { CLEAR_BEYOND, EVEN_WITHIN, expectationFromChance } from '../src/rally-rating.js'

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

const clearly = 0.5 + CLEAR_BEYOND + 0.001
const slightly = 0.5 + (EVEN_WITHIN + CLEAR_BEYOND) / 2
const barely = 0.5 + EVEN_WITHIN / 2

section('which side was favoured')
{
  check('a clear favourite who won',
    expectationFromChance(clearly, true), { expected: 'win', margin: 'clear', upset: false },
    `more than ${CLEAR_BEYOND} above an even chance is clear`)
  check('a clear underdog who won is an upset',
    expectationFromChance(1 - clearly, true), { expected: 'loss', margin: 'clear', upset: true },
    'the result went against a named favourite')
  check('a slight favourite who lost is a slip',
    expectationFromChance(slightly, false), { expected: 'win', margin: 'slight', upset: true },
    'upset is symmetric; the app calls this one a slip')
  check('a slight underdog who lost as expected',
    expectationFromChance(1 - slightly, false), { expected: 'loss', margin: 'slight', upset: false },
    'losing the one you were expected to lose is not an upset')
}

section('level is said as level')
{
  check('inside the even band nobody is favourite',
    expectationFromChance(barely, false), { expected: 'even', margin: null, upset: false },
    `within ${EVEN_WITHIN} of an even chance, naming a favourite would be false precision`)
  // A hair past each edge rather than exactly on it: 0.5 + 0.1 is
  // 0.09999999999999998 away from 0.5 in floating point.
  check('just past the even edge counts as a lean',
    expectationFromChance(0.5 + EVEN_WITHIN + 1e-9, true).expected, 'win',
    'the even band ends at its edge')
  check('just past the clear edge counts as clear',
    expectationFromChance(0.5 + CLEAR_BEYOND + 1e-9, true).margin, 'clear',
    'the clear band starts at its edge')
}

section('when nothing can be said')
{
  check('no chance, no expectation',
    expectationFromChance(Number.NaN, true), null, 'the page shows nothing rather than a hedge')
  check('a match with no winner is never an upset',
    expectationFromChance(1 - clearly, null), { expected: 'loss', margin: 'clear', upset: false },
    'there is no result to have gone against the expectation')
  check('the bands are in order',
    EVEN_WITHIN > 0 && CLEAR_BEYOND > EVEN_WITHIN && CLEAR_BEYOND < 0.5, true,
    'even sits inside slight, which sits inside clear')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
