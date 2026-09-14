#!/usr/bin/env node
// ============================================================
// How big should the match reward be?
//
//   UMPIRE_TOKEN=... node server/scripts/match-reward-sizes.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Replays staging's completed matches at several reward
// sizes and prints, for each, what it would do:
//
//   winners down  how many players on a winning side still ended the
//                 match with fewer (rounded) points, and the worst case
//   messy winner  a simulation of level doubles matches the side won,
//                 where one partner makes most of the mistakes: each
//                 partner's average change
//   true order    how closely the ratings rank the synthetic players by
//                 their hidden ability (Spearman, -1 to 1; 1 is perfect)
//   picks winner  built on the earlier 70% of matches, how often the
//                 favourite won the later 30% (everyone on court rated)
//
// The owner chooses the size; nothing here writes anything.
// ============================================================

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gameWinChance } from '../src/game-chance.js'
import { DEFAULT_POINT_TARGET, deriveMatchState } from '../src/pickleball.js'
import { rallyEnding } from '../src/rally-endings.js'
import { MIN_MATCHES, START_POINTS, expectedWin, rateHistory } from '../src/rally-rating.js'

const SIZES = [0, 8, 16, 24, 32, 48]

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/match-reward-sizes.mjs <API_URL>')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))

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
matches.sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt) || a.id.localeCompare(b.id))
console.log(`completed matches with a winner: ${matches.length}`)

function winnersDown(matchReward) {
  const ratings = rateHistory(matches, { matchReward })
  let total = 0
  let down = 0
  let worst = 0
  for (const match of matches) {
    for (const id of match.winner === 'A' ? match.teamA : match.teamB) {
      const facts = ratings.get(id).matchFacts[match.id]
      const change = Math.round(facts.after) - Math.round(facts.before)
      total += 1
      if (change < 0) down += 1
      worst = Math.min(worst, change)
    }
  }
  return `${down}/${total}, worst ${worst}`
}

// A small seeded generator, so every size sees the same simulated matches.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const MESSY = [[4, 'A2', 'putaway'], [5, 'A1', 'out'], [1, 'A1', 'putaway'], [2, 'B1', 'putaway'], [2, 'B2', 'putaway'], [3, 'B1', 'net'], [3, 'B2', 'out']]
function simulatedMatch(random) {
  const match = {
    id: randomUUID(), endedAt: '2026-09-01T10:00:00Z', teamA: ['A1', 'A2'], teamB: ['B1', 'B2'],
    firstServer: { team: 'A', playerId: 'A1' }, rightStart: { A: 'A1', B: 'B1' }, pointTarget: 11, events: [],
  }
  const weight = MESSY.reduce((sum, [w]) => sum + w, 0)
  while (!deriveMatchState(match).completed) {
    let pick = random() * weight
    const [, player, key] = MESSY.find(([w]) => (pick -= w) < 0) ?? MESSY.at(-1)
    const ending = rallyEnding(key)
    match.events.push({ type: 'rally', id: randomUUID(), actingPlayerId: player, outcome: ending.outcome, zone: ending.zone, detail: ending.key })
  }
  return match
}
const random = seeded(20260914)
const simulated = Array.from({ length: 400 }, () => simulatedMatch(random)).filter((m) => deriveMatchState(m).winner === 'A')

function messyWinner(matchReward) {
  let messy = 0
  let carrier = 0
  for (const match of simulated) {
    const ratings = rateHistory([match], { matchReward })
    messy += ratings.get('A1').rawPoints - START_POINTS
    carrier += ratings.get('A2').rawPoints - START_POINTS
  }
  const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
  return `${signed(messy / simulated.length)} / ${signed(carrier / simulated.length)}`
}

const truthPath = join(here, '.sim-pool-truth.json')
const truth = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')).players : null
function trueOrder(matchReward) {
  if (!truth) return 'no truth file'
  const ratings = rateHistory(matches, { matchReward })
  const pairs = truth.map((p) => [p.ability, ratings.get(p.id)]).filter(([, r]) => r && r.matches >= MIN_MATCHES)
  const rank = (values) => {
    const ranks = new Array(values.length)
    values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).forEach(([, i], r) => { ranks[i] = r })
    return ranks
  }
  const ra = rank(pairs.map(([ability]) => ability))
  const rb = rank(pairs.map(([, r]) => r.rawPoints))
  const n = pairs.length
  const d2 = ra.reduce((sum, r, i) => sum + (r - rb[i]) ** 2, 0)
  return `${(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3)} (${n})`
}

const cut = Math.floor(matches.length * 0.7)
function picksWinner(matchReward) {
  const built = rateHistory(matches.slice(0, cut), { matchReward })
  let right = 0
  let total = 0
  for (const match of matches.slice(cut)) {
    const everyone = [...match.teamA, ...match.teamB].map((id) => built.get(id))
    if (everyone.some((r) => !r || r.matches < MIN_MATCHES)) continue
    const mean = (ids) => ids.reduce((sum, id) => sum + built.get(id).rawPoints, 0) / ids.length
    const chanceA = gameWinChance(expectedWin(mean(match.teamA), mean(match.teamB)), {
      doubles: match.teamA.length === 2,
      target: match.pointTarget ?? DEFAULT_POINT_TARGET,
      firstServer: match.firstServer.team,
    })
    total += 1
    if ((chanceA > 0.5) === (match.winner === 'A')) right += 1
  }
  return total ? `${right}/${total} (${Math.round((right / total) * 100)}%)` : '0/0'
}

console.log(`simulated messy wins: ${simulated.length} (messy partner / carrying partner)\n`)
console.log('size | winners down     | messy winner    | true order   | picks winner')
for (const size of SIZES) {
  console.log(`${String(size).padStart(4)} | ${winnersDown(size).padEnd(16)} | ${messyWinner(size).padEnd(15)} | ${trueOrder(size).padEnd(12)} | ${picksWinner(size)}`)
}
