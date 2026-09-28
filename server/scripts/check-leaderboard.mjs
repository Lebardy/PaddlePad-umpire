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
import { buildMonthLists, isLeaderboardOpen, pprAtStart, rankingOf, stepUpLeaders, topFive, yourStanding } from '../src/leaderboard.js'

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

const DAY = 86_400_000
const now = Date.parse('2026-09-28T04:00:00Z')
const rated = (points, matches, daysAgo) => ({
  points, matches, timeline: [{ at: new Date(now - daysAgo * DAY).toISOString(), points }],
})

section('who is on the ranking')
{
  const ratings = new Map([
    ['ana', rated(1612, 31, 2)],
    ['ben', rated(1538, 14, 5)],
    ['cy', rated(1538, 22, 1)],
    ['dee', rated(1529, 10, 60)], // exactly 60 days: still on
    ['eli', rated(1600, 12, 61)], // 61 days: off
    ['fay', rated(1650, 9, 1)], // 9 matches: off
    ['gus', rated(1700, 40, 1)], // closed account: off
  ])
  const players = new Map([
    ['ana', { name: 'Ana', closed: false }], ['ben', { name: 'Ben', closed: false }],
    ['cy', { name: 'Cy', closed: false }], ['dee', { name: 'Dee', closed: false }],
    ['eli', { name: 'Eli', closed: false }], ['fay', { name: 'Fay', closed: false }],
    ['gus', { name: 'Gus', closed: true }],
  ])
  const ranking = rankingOf(ratings, players, now)
  check('order, shared places and who is left off',
    ranking.map((r) => [r.place, r.name, r.points]),
    [[1, 'Ana', 1612], [2, 'Ben', 1538], [2, 'Cy', 1538], [4, 'Dee', 1529]])

  check('39 players: closed', isLeaderboardOpen(Array(39).fill({})), false)
  check('40 players: open', isLeaderboardOpen(Array(40).fill({})), true)
  check('a lowered limit (staging only)', isLeaderboardOpen(Array(3).fill({}), 3), true)

  check('you, behind a tie', yourStanding(ranking, ratings, 'dee'),
    { state: 'on', place: 4, of: 4, points: 1529, behind: { points: 9, name: 'Ben', others: 1, place: 2 } })
  check('you, at the top', yourStanding(ranking, ratings, 'ana'),
    { state: 'on', place: 1, of: 4, points: 1612, behind: null })
  check('you, with 9 matches', yourStanding(ranking, ratings, 'fay'), { state: 'needs_matches', have: 9, need: 10 })
  check('you, never rated', yourStanding(ranking, ratings, 'new'), { state: 'needs_matches', have: 0, need: 10 })
  check('you, away too long', yourStanding(ranking, ratings, 'eli'),
    { state: 'away', lastPlayedAt: new Date(now - 61 * DAY).toISOString() })
}

section('top five with ties')
{
  const visible = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const nameOf = new Map([...visible].map((id) => [id, id.toUpperCase()]))
  const counts = new Map([['a', 9], ['b', 7], ['c', 7], ['d', 5], ['e', 1], ['f', 1], ['g', 1], ['h', 1], ['gone', 12]])
  check('five rows, then the tie that runs on', topFive(counts, visible, nameOf), {
    rows: [
      { name: 'A', count: 9, place: 1 }, { name: 'B', count: 7, place: 2 }, { name: 'C', count: 7, place: 2 },
      { name: 'D', count: 5, place: 4 }, { name: 'E', count: 1, place: 5 },
    ],
    moreTied: 3,
    moreCount: 1,
  })
  check('an empty month', topFive(new Map(), visible, nameOf), { rows: [], moreTied: 0, moreCount: null })
}

section('PPR at the start of the month')
{
  const startAt = new Date('2026-09-01T00:00:00+08:00')
  const rating = { points: 1540, timeline: [
    { at: '2026-08-20T10:00:00Z', points: 1490 }, { at: '2026-08-31T15:00:00Z', points: 1502 }, // 23:00 on 31 Aug in Manila
    { at: '2026-09-02T10:00:00Z', points: 1530 },
  ] }
  check('the last match before the 1st', pprAtStart(rating, startAt), 1502)
  check('nothing before the 1st starts at 1,500', pprAtStart({ points: 1520, timeline: [{ at: '2026-09-05T00:00:00Z', points: 1520 }] }, startAt), 1500)
}

section('Step up, by category')
{
  const T = (o) => ({ matches: 3, winners: 10, errors: 10, rallies: 100, sideWon: 50, ownMistakes: 30, won: 1, decided: 3, ...o })
  const visible = new Set(['ana', 'ben', 'cy', 'dee', 'few'])
  const nameOf = new Map([['ana', 'Ana'], ['ben', 'Ben'], ['cy', 'Cy'], ['dee', 'Dee'], ['few', 'Few'], ['gone', 'Gone']])
  const progress = [
    // PPR +38; shots 1.0 -> 1.8; mistakes 30% -> 22%; wins 1/3 -> 3/3; rallies 50% -> 55%
    { id: 'ana', before: T(), thisMonth: T({ winners: 18, ownMistakes: 22, won: 3, sideWon: 55 }), pprStart: 1500, pprNow: 1652 },
    // PPR +9 (under 10); shots 1.0 -> 1.1 (under 20%); rallies 50% -> 60%
    { id: 'ben', before: T(), thisMonth: T({ winners: 11, sideWon: 60 }), pprStart: 1500, pprNow: 1536 },
    // Mistakes 30% -> 22%: ties Ana on the drop, with the same figures
    { id: 'cy', before: T(), thisMonth: T({ ownMistakes: 22 }), pprStart: 1500, pprNow: 1500 },
    // Would win everything, but closed
    { id: 'gone', before: T(), thisMonth: T({ winners: 50, ownMistakes: 1, won: 3, sideWon: 90 }), pprStart: 1400, pprNow: 1600 },
    // Only 2 matches before
    { id: 'few', before: T({ matches: 2 }), thisMonth: T({ winners: 50, won: 3, sideWon: 90 }), pprStart: 1400, pprNow: 1600 },
  ]
  const leaders = stepUpLeaders(progress, visible, nameOf)
  check('PPR gained', leaders[0], { key: 'ppr', names: ['Ana'], more: 0, figures: { change: 152 } })
  check('shots per mistake', leaders[1], { key: 'shots', names: ['Ana'], more: 0, figures: { before: 1, now: 1.8 } })
  check('fewer mistakes, tied with the same figures', leaders[2],
    { key: 'mistakes', names: ['Ana', 'Cy'], more: 0, figures: { before: 30, now: 22 } })
  check('win rate', leaders[3], { key: 'winRate', names: ['Ana'], more: 0, figures: { before: 33, now: 100 } })
  check('rallies won', leaders[4], { key: 'rallies', names: ['Ben'], more: 0, figures: { before: 50, now: 60 } })

  const quiet = stepUpLeaders([progress[1]].map((p) => ({ ...p, thisMonth: T({ winners: 11 }) })), visible, nameOf)
  check('a category nobody reaches is empty', quiet.map((l) => l.names), [null, null, null, null, null])

  const noMistakes = stepUpLeaders([{ id: 'dee', before: T({ winners: 5, errors: 10 }), thisMonth: T({ winners: 9, errors: 0 }) }], visible, nameOf)
  check('no mistakes this month', noMistakes[1].figures, { before: 0.5, now: null })

  const differ = stepUpLeaders([
    { id: 'ana', before: T({ won: 1 }), thisMonth: T({ won: 2 }) }, // 33 -> 67
    { id: 'ben', before: T({ won: 0 }), thisMonth: T({ won: 1 }) }, // 0 -> 33
  ], visible, nameOf)
  check('tied leaders with different figures share their change', differ[3],
    { key: 'winRate', names: ['Ana', 'Ben'], more: 0, figures: { change: 33 } })
}

section('the month lists together')
{
  const lists = buildMonthLists({ matches: [], visible: new Set(), nameOf: new Map(), progress: [], history: [] })
  check('an empty month', lists, {
    playedMost: { rows: [], moreTied: 0, moreCount: null },
    metMost: { rows: [], moreTied: 0, moreCount: null },
    stepUp: ['ppr', 'shots', 'mistakes', 'winRate', 'rallies'].map((key) => ({ key, names: null })),
    matchOfTheMonth: null,
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
