#!/usr/bin/env node
// ============================================================
// How well does the rally rating predict who wins?
//
//   UMPIRE_TOKEN=... node server/scripts/rally-rating-prediction.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Matches are split by when they ended: the earlier 70% build
// the ratings, the later 30% are predicted, so no rating sees the result
// it predicts. k and scale are chosen using the earlier matches alone,
// by replaying them and scoring every counted rally's pre-rally forecast
// (mean per-rally log loss) -- not by holding out a slice of them, which
// on this little data was too small a sample to pick anything real.
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

/**
 * Accuracy and count of the rated test matches. Only accuracy: the
 * per-rally win chance this rating produces is not a calibrated
 * match-win probability (a match is many rallies, so even a small
 * per-rally edge compounds into a lopsided match outcome), so there is
 * no honest probability here to score with something like a Brier
 * score -- only which side it points to, which is what accuracy checks.
 */
function evaluate(built, onMatches, scale) {
  let right = 0
  let total = 0
  for (const m of onMatches) {
    const side = (ids) => ids.map((id) => built.get(id))
    const a = side(m.teamA)
    const b = side(m.teamB)
    if ([...a, ...b].some((r) => !r || r.matches < MIN_MATCHES)) continue
    const mean = (rs) => rs.reduce((s, r) => s + r.rawPoints, 0) / rs.length
    const chanceA = expectedWin(mean(a), mean(b), scale)
    if (chanceA === 0.5) continue
    const aWon = m.winner === 'A'
    total += 1
    right += Number((chanceA > 0.5) === aWon)
  }
  return { total, accuracy: total ? right / total : NaN }
}

function wilson(p, n) {
  const z = 1.96
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [centre - half, centre + half]
}

/**
 * Mean per-rally log loss for one (k, scale) combination: replay
 * `matches` and, for every counted rally, take the pre-rally chance the
 * side that actually won the rally was given, then average -log(chance)
 * over every rally. Lower is a better-calibrated forecast. Each rally's
 * chance only ever depends on ratings built from rallies before it, so
 * this needs no held-out slice of its own -- unlike a held-out slice of
 * only a handful of matches, every counted rally contributes one data
 * point, which is what makes this stable enough to tune on.
 */
function tuningLoss(matches, k, scale) {
  let loss = 0
  let count = 0
  rateHistory(matches, {
    k,
    scale,
    onRally: ({ expected }) => {
      loss += -Math.log(expected)
      count += 1
    },
  })
  return count ? loss / count : NaN
}

// Tune on the earlier matches only; the later matches stay untouched.
let best = null
for (const k of [2, 4, 8, 12, 16, 24]) {
  for (const scale of [100, 200, 400, 800]) {
    const loss = tuningLoss(train, k, scale)
    if (!Number.isFinite(loss)) continue
    if (!best || loss < best.loss) best = { k, scale, loss }
  }
}
if (!best) {
  console.error('no (k, scale) combination produced a scorable rally on the earlier matches; cannot tune')
  process.exit(1)
}
console.log(`tuned on earlier matches: k=${best.k}, scale=${best.scale} (mean per-rally log loss ${best.loss.toFixed(3)})`)

const built = rateHistory(train, { k: best.k, scale: best.scale })
const result = evaluate(built, test, best.scale)
if (result.total === 0) {
  console.error('no later match had all four players rated; cannot report an accuracy')
  process.exit(1)
}
const [low, high] = wilson(result.accuracy, result.total)
console.log(
  `rally rating on later matches: ${(result.accuracy * 100).toFixed(1)}% of ${result.total}` +
  ` (95% range ${(low * 100).toFixed(0)}%-${(high * 100).toFixed(0)}%)`,
)
console.log('(accuracy only -- the per-rally win chance is not a calibrated match-win probability, so no Brier score is reported)')

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
