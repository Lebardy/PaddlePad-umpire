#!/usr/bin/env node
// ============================================================
// The leaderboard's rules, checked against answers written by hand.
//
//   node server/scripts/check-leaderboard.mjs
//
// Everything here is pure -- plain data in, answers out -- so every
// rule that decides who is ranked and named is proven with no database.
// ============================================================

import { rallyCounts } from '../src/player-stats.js'
import { totalsOf } from '../src/board.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)

section('rally counts for one player')
{
  const rally = (actingPlayerId, outcome) => ({ type: 'rally', actingPlayerId, outcome })
  const events = [
    rally('Ana', 'winner'), // Ana's side wins
    rally('Ana', 'error'), // Ana's own mistake: her side loses
    rally('Ben', 'winner'), // partner wins it
    rally('Cy', 'error'), // opponent's mistake: Ana's side wins
    rally('Dee', 'winner'), // opponent wins it
    { type: 'third_shot', actingPlayerId: 'Ana' }, // not a rally
  ]
  check('doubles, from Ana', rallyCounts(['Ana', 'Ben'], ['Cy', 'Dee'], events, 'Ana'),
    { rallies: 5, sideWon: 3, ownMistakes: 1 })
  check('the same match from Dee', rallyCounts(['Ana', 'Ben'], ['Cy', 'Dee'], events, 'Dee'),
    { rallies: 5, sideWon: 2, ownMistakes: 0 })
  check('no rallies', rallyCounts(['Ana'], ['Cy'], [], 'Ana'), { rallies: 0, sideWon: 0, ownMistakes: 0 })
}

section('month totals')
{
  const m = (won, stats, counts) => ({ won, stats, rallyCounts: counts })
  const stats = { clean_winners: 2, dink_winners: 1, unforced_errors: 1, dink_errors: 1 }
  check('added up, with an undecided match', totalsOf([
    m(true, stats, { rallies: 20, sideWon: 12, ownMistakes: 2 }),
    m(false, stats, { rallies: 18, sideWon: 7, ownMistakes: 3 }),
    m(null, stats, { rallies: 4, sideWon: 2, ownMistakes: 0 }),
  ]), { matches: 3, winners: 9, errors: 6, rallies: 42, sideWon: 21, ownMistakes: 5, won: 1, decided: 2 })
  check('older rows without rally counts still add up', totalsOf([{ won: true, stats }]),
    { matches: 1, winners: 3, errors: 2, rallies: 0, sideWon: 0, ownMistakes: 0, won: 1, decided: 1 })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
