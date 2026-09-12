#!/usr/bin/env node
// ============================================================
// What was expected of a match, and the games behind a rating.
//
//   node server/scripts/check-expectation.mjs
//
// Both modules are pure, so the arithmetic and the two rules that
// matter -- only what was knowable beforehand, and no number about
// anybody else -- are provable here with no database and no network.
// ============================================================

import {
  CLEAR_GAP, EVEN_WITHIN, expectationFor, sideRating,
} from '../src/expectation.js'
import { MIN_GAMES_FOR_SPREAD, summariseGames } from '../src/game-scores.js'

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

// ============================================================
section('the games behind a rating')
// ============================================================
{
  // Nine games. Sorted: 30 40 45 50 55 58 62 70 90, summing to 500,
  // so the mean is 55.6 -- and a rating is the mean of these, exactly.
  const scores = [50, 90, 45, 62, 30, 55, 70, 40, 58]
  const games = scores.map((score, i) => ({ matchId: `m${i}`, score }))
  const summary = summariseGames(games, 55.6)

  check('count, ends and average',
    [summary.count, summary.worst, summary.best, summary.average],
    [9, 30, 90, 55.6],
    'the average is the rating; that is the whole claim the page makes')
  check('the middle half',
    [summary.lower, summary.upper], [45, 62],
    'nine sorted values: the 25th is the 3rd (45) and the 75th the 7th (62)')
  check('every game keeps the match it was played in',
    summary.games.length, 9,
    'so a game on this strip and a game in the history are the same game')
  check('nothing fell off the scale here',
    summary.outsideScale, 0,
    'counted rather than clipped away -- the page clips what it draws and says so')
}

{
  const wild = [-8, 20, 50, 75, 104, 60].map((score, i) => ({ matchId: `m${i}`, score }))
  check('games outside 0-100 are counted, not dropped',
    summariseGames(wild, 50.2).outsideScale, 2,
    'the scale is built from players\' averages, so one game can beat the best of them')
}

{
  const few = [50, 60, 40].map((score, i) => ({ matchId: `m${i}`, score }))
  check(`under ${MIN_GAMES_FOR_SPREAD} games there is no spread to describe`,
    summariseGames(few, 50), null,
    'a best day out of three is the day you got lucky, and the page says nothing instead')
  check('and a run that never sent them says nothing either',
    summariseGames(null, 50), null,
    'an older pipeline; the rating above it is still true')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
