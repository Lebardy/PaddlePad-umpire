#!/usr/bin/env node
// ============================================================
// "Your best" on the Overview: biggest win, biggest comeback, cleanest
// match -- one row of three, each one a way into its match.
//
//   node player/scripts/check-bests.mjs
// ============================================================

const { personalBests } = await import('../src/lib/derive.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const stats = (winners, errors) => ({ clean_winners: winners, dink_winners: 0, unforced_errors: errors, dink_errors: 0 })
const matches = [
  { id: 'a', won: true, yourScore: 15, theirScore: 5, opponents: ['Rica', 'Denise'], progression: [1, 2, 3], stats: stats(6, 2), isDoubles: true },
  { id: 'b', won: true, yourScore: 12, theirScore: 10, opponents: ['Ivy'], progression: [-1, -3, -5, -2, 1, 2], stats: stats(2, 1), isDoubles: false },
  { id: 'c', won: false, yourScore: 4, theirScore: 11, opponents: ['Marco'], progression: [-1, -2], stats: stats(1, 5), isDoubles: false },
]

check('three tiles, in order', personalBests(matches).map((b) => [b.key, b.label, b.value, b.detail, b.matchId]), [
  ['margin', 'Biggest win', '15–5', 'vs Rica & Denise', 'a'],
  ['comeback', 'Biggest comeback', '5 down', 'won 12–10', 'b'],
  ['ratio', 'Cleanest match', '3.0', 'winning shots per mistake', 'a'],
])
check('no wins: only the cleanest match', personalBests([matches[2]]).map((b) => b.key), ['ratio'])
check('a win never behind: no comeback tile', personalBests([matches[0]]).map((b) => b.key), ['margin', 'ratio'])
check('no matches, no tiles', personalBests([]), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
