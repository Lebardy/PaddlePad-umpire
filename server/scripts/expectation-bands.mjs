#!/usr/bin/env node
// ============================================================
// Where "evenly matched" ends and a favourite begins.
//
//   UMPIRE_TOKEN=... node server/scripts/expectation-bands.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Replays every completed match with a winner and, for each
// match where everyone on court already had five matches, takes team
// A's pre-match chance of winning a rally. Then tries candidate band
// edges and prints how often the favourite actually won in each band,
// recommending the pair that calls the most matches "clear" while clear
// favourites win at least three times in four and slight favourites
// more than half the time.
// ============================================================

import { MIN_MATCHES, expectedWin, rateHistory } from '../src/rally-rating.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/expectation-bands.mjs <API_URL>')
  process.exit(2)
}

async function get(path) {
  const response = await fetch(API + path, { headers: { authorization: `Bearer ${TOKEN}` } })
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  return response.json()
}

const { sessions } = await get('/sessions')
const matches = []
for (const session of sessions.filter((s) => !s.voided_at)) {
  const { matches: listed } = await get(`/matches/session/${session.id}`)
  for (const summary of listed.filter((m) => m.status === 'completed' && !m.voidedAt && m.endedAt)) {
    const { match } = await get(`/matches/${summary.id}`)
    if (match.winner) matches.push(match)
  }
}

const ratings = rateHistory(matches)
const called = []
for (const match of matches) {
  const facts = ratings.get(match.teamA[0])?.matchFacts?.[match.id]
  if (!facts?.established) continue
  called.push({ chance: expectedWin(facts.yourSide, facts.theirSide), aWon: match.winner === 'A' })
}
console.log(`matches with a winner: ${matches.length}; with everyone established (${MIN_MATCHES}+ matches): ${called.length}`)

function bands(evenWithin, clearBeyond) {
  const out = { even: [0, 0], slight: [0, 0], clear: [0, 0] }
  for (const { chance, aWon } of called) {
    const lean = Math.abs(chance - 0.5)
    const band = lean < evenWithin ? 'even' : lean >= clearBeyond ? 'clear' : 'slight'
    const favouriteWon = band === 'even' ? aWon : (chance > 0.5) === aWon
    out[band][0] += 1
    out[band][1] += favouriteWon ? 1 : 0
  }
  return out
}

const rate = ([n, won]) => (n ? `${won}/${n} (${Math.round((won / n) * 100)}%)` : '0/0')
let best = null
console.log('\neven<  clear>=  | even (A won)  | slight fav won | clear fav won')
for (const evenWithin of [0.005, 0.01, 0.015, 0.02, 0.025, 0.03]) {
  for (const clearBeyond of [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1]) {
    if (clearBeyond <= evenWithin) continue
    const b = bands(evenWithin, clearBeyond)
    console.log(`${evenWithin.toFixed(3)}  ${clearBeyond.toFixed(2)}    | ${rate(b.even).padEnd(13)} | ${rate(b.slight).padEnd(14)} | ${rate(b.clear)}`)
    const clearOk = b.clear[0] >= 5 && b.clear[1] / b.clear[0] >= 0.75
    const slightOk = b.slight[0] === 0 || b.slight[1] / b.slight[0] > 0.5
    if (clearOk && slightOk && (!best || b.clear[0] > best.b.clear[0])) best = { evenWithin, clearBeyond, b }
  }
}

if (best) {
  console.log(`\nrecommended: EVEN_WITHIN = ${best.evenWithin}, CLEAR_BEYOND = ${best.clearBeyond}`)
  console.log(`  even ${rate(best.b.even)} A won, slight favourites ${rate(best.b.slight)}, clear favourites ${rate(best.b.clear)}`)
} else {
  console.log('\nno pair meets the targets (clear favourites winning 3 in 4 over 5+ matches, slight more than half)')
}
