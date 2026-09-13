#!/usr/bin/env node
// ============================================================
// How well does the rally rating predict who wins?
//
//   UMPIRE_TOKEN=... node server/scripts/rally-rating-prediction.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Matches are split by when they ended: the earlier 70% build
// the ratings, the later 30% are predicted, so no rating sees the result
// it predicts. k and scale are chosen using the earlier matches alone
// (the earlier 70% of THOSE build, the rest are predicted), then the
// winner is checked on the later matches.
//
// Writes server/scripts/.rating-split.json so ml/scripts/
// skill_score_prediction.py tests the old score on the very same matches.
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MIN_MATCHES, START_POINTS, expectedWin, rateHistory } from '../src/rally-rating.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/rally-rating-prediction.mjs <API_URL>')
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
    if (!match.winner) continue
    matches.push({ ...match, endedAt: match.endedAt })
  }
}
matches.sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt) || a.id.localeCompare(b.id))

const cut = Math.floor(matches.length * 0.7)
const train = matches.slice(0, cut)
const test = matches.slice(cut)
console.log(`completed matches with a winner: ${matches.length} (build ${train.length}, predict ${test.length})`)

/** Accuracy, Brier score and count of the rated test matches. */
function evaluate(built, onMatches, scale) {
  let right = 0
  let total = 0
  let brier = 0
  for (const m of onMatches) {
    const side = (ids) => ids.map((id) => built.get(id))
    const a = side(m.teamA)
    const b = side(m.teamB)
    if ([...a, ...b].some((r) => !r || r.matches < MIN_MATCHES)) continue
    const mean = (rs) => rs.reduce((s, r) => s + r.rawPoints, 0) / rs.length
    // A match is a long run of rallies, so a small per-rally edge becomes
    // a large match edge; the per-rally chance still orders sides
    // correctly, which is what accuracy measures, and Brier uses it as
    // the side's chance of the match.
    const chanceA = expectedWin(mean(a), mean(b), scale)
    if (chanceA === 0.5) continue
    const aWon = m.winner === 'A'
    total += 1
    right += Number((chanceA > 0.5) === aWon)
    brier += (chanceA - Number(aWon)) ** 2
  }
  return { total, accuracy: total ? right / total : NaN, brier: total ? brier / total : NaN }
}

function wilson(p, n) {
  const z = 1.96
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [centre - half, centre + half]
}

// Tune on the earlier matches only.
const innerCut = Math.floor(train.length * 0.7)
let best = null
for (const k of [2, 4, 8, 12, 16, 24]) {
  for (const scale of [100, 200, 400, 800]) {
    const result = evaluate(rateHistory(train.slice(0, innerCut), { k, scale }), train.slice(innerCut), scale)
    if (result.total === 0) continue
    if (!best || result.accuracy > best.accuracy || (result.accuracy === best.accuracy && result.brier < best.brier)) {
      best = { k, scale, ...result }
    }
  }
}
console.log(`tuned on earlier matches: k=${best.k}, scale=${best.scale} (inner accuracy ${(best.accuracy * 100).toFixed(1)}% of ${best.total})`)

const built = rateHistory(train, { k: best.k, scale: best.scale })
const result = evaluate(built, test, best.scale)
const [low, high] = wilson(result.accuracy, result.total)
console.log(
  `rally rating on later matches: ${(result.accuracy * 100).toFixed(1)}% of ${result.total}` +
  ` (95% range ${(low * 100).toFixed(0)}%-${(high * 100).toFixed(0)}%), Brier ${result.brier.toFixed(3)}`,
)

writeFileSync(
  join(here, '.rating-split.json'),
  JSON.stringify({ train: train.map((m) => m.id), test: test.map((m) => m.id), best: { k: best.k, scale: best.scale } }, null, 2),
)

const truthPath = join(here, '.sim-pool-truth.json')
if (existsSync(truthPath)) {
  const truth = JSON.parse(readFileSync(truthPath, 'utf8')).players
  const everything = rateHistory(matches, { k: best.k, scale: best.scale })
  const pairs = truth
    .map((p) => [p.ability, everything.get(p.id)])
    .filter(([, r]) => r && r.matches >= MIN_MATCHES)
    .map(([ability, r]) => [ability, r.rawPoints])
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
    const ranks = new Array(values.length)
    order.forEach(([, i], r) => { ranks[i] = r })
    return ranks
  }
  const ra = rank(pairs.map((p) => p[0]))
  const rb = rank(pairs.map((p) => p[1]))
  const n = pairs.length
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0)
  console.log(`rally rating vs true ability (all matches, ${n} players): Spearman ${(1 - (6 * d2) / (n * (n * n - 1))).toFixed(2)}`)
}
console.log(`(starting points ${START_POINTS}; split written to server/scripts/.rating-split.json)`)
