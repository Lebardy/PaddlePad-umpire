#!/usr/bin/env node
// ============================================================
// Tops staging up with the nights its invented places would have played
// since their last recorded match, so "this month" on the Leaderboard
// and the last-7-days rating line have something in them.
//
//   node --env-file=server/.env.smoke --env-file=server/.env.seed \
//     server/scripts/seed-recent.mjs https://api-staging-8ac6.up.railway.app [--dry]
//
// STAGING ONLY. Goes through the API as one seed umpire per place -- no
// database credentials -- so every match passes the same validation as
// one scored courtside. The API takes a match's start and each event's
// time from the device, which is what lets these nights carry the dates
// they would have been played on.
//
// Nothing here is invented from scratch. Which nights a place plays, how
// many matches, who turns up, singles or doubles, the point target and
// how each player's rallies tend to end are all read from that place's
// own history, so a top-up looks like more of the same. Only players who
// have already played at these places are used; anyone else on staging
// (real people among them) is never touched.
//
// Needs SEED_UMPIRE_PASSWORD (the four accounts below) and
// SMOKE_INTERNAL_KEY (to read how each player has played so far).
// Safe to run again: it starts from the day after the newest match.
// ============================================================

import { randomUUID } from 'node:crypto'
import { currentServerPlayerId, deriveMatchState } from '../src/pickleball.js'
import { RALLY_ENDINGS } from '../src/rally-endings.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const DRY = process.argv.includes('--dry')
const PASSWORD = process.env.SEED_UMPIRE_PASSWORD
const INTERNAL_KEY = process.env.SMOKE_INTERNAL_KEY
if (!API || !PASSWORD || !INTERNAL_KEY || !/staging|localhost|127\.0\.0\.1/.test(API)) {
  console.error('usage: node --env-file=server/.env.smoke --env-file=server/.env.seed server/scripts/seed-recent.mjs <STAGING_API_URL> [--dry]')
  console.error('Refuses any API that is not staging or local.')
  process.exit(2)
}

// One seed umpire per invented place. Each signs in with the same
// password; the umpires the places were first seeded with have none.
const SEED_UMPIRES = [
  'paolo.sy@example.com', // Boulevard Paddle Courts
  'tessa.ramos@example.com', // Piapi Sports Hub
  'noel.garcia@example.com', // Sibulan Community Court
  'bea.lim@example.com', // Valencia Highland Courts
]

const DEVICE = `seed-${randomUUID().slice(0, 8)}`
const MANILA_MS = 8 * 3_600_000
const DAY_MS = 86_400_000
const MIN = 60_000

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo)
const chance = (p) => Math.random() < p
const sample = (list) => list[Math.floor(Math.random() * list.length)]
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const pick = (weighted) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  for (const [value, w] of weighted) {
    roll -= w
    if (roll <= 0) return value
  }
  return weighted[weighted.length - 1][0]
}
/** The Manila calendar day a moment falls on, as a day number. */
const manilaDay = (ms) => Math.floor((ms + MANILA_MS) / DAY_MS)

// ============================================================
// How each player has played so far
// ============================================================
const logs = await call('/internal/match-logs.json', { headers: { 'x-internal-key': INTERNAL_KEY } })
const totals = new Map()
for (const row of logs.rows) {
  const t = totals.get(row.player_id) ?? { winners: 0, errors: 0, dinks: 0, drops: 0, drives: 0, landed: 0 }
  t.winners += row.clean_winners + row.dink_winners
  t.errors += row.unforced_errors + row.dink_errors
  t.dinks += row.dink_winners + row.dink_errors
  t.drops += row.drop_attempts
  t.drives += row.drive_attempts
  t.landed += row.drop_successes
  totals.set(row.player_id, t)
}
/**
 * The same hidden numbers seed-sim-pool.mjs draws at random, read off
 * the player's record instead. `form` is this run's own nudge: without
 * it everyone plays exactly as before and nobody steps up.
 */
function traitsOf(id) {
  const t = totals.get(id) ?? { winners: 1, errors: 1, dinks: 1, drops: 1, drives: 1, landed: 0.5 }
  const ended = t.winners + t.errors
  return {
    id,
    ability: clamp((ended ? t.winners / ended : 0.5) + rand(-0.07, 0.07), 0.2, 0.88),
    netPlay: clamp(ended ? t.dinks / ended : 0.4, 0.1, 0.85),
    dropPreference: clamp(t.drops + t.drives ? t.drops / (t.drops + t.drives) : 0.5, 0.1, 0.95),
    dropLands: clamp(t.drops ? t.landed / t.drops : 0.55, 0.2, 0.9),
  }
}

// ============================================================
// How a rally ends, from who ended it (as in seed-sim-pool.mjs)
// ============================================================
const ending = (key) => RALLY_ENDINGS.find((e) => e.key === key)

function endingFor(person, isServer) {
  const atNet = chance(person.netPlay)
  if (chance(person.ability)) {
    if (atNet) return ending('dink_winner')
    return pick([
      ...(isServer ? [[ending('ace'), 0.6]] : []),
      [ending('putaway'), 3],
      [ending('passing'), 2],
      [ending('lob'), 0.8],
      [ending('drop_winner'), 1.2],
      [ending('other_winner'), 0.4],
    ])
  }
  if (atNet) return pick([[ending('dink_error'), 3], [ending('kitchen'), 1]])
  const careless = 1 - person.ability
  return pick([
    [ending('out'), 3],
    [ending('net'), 3],
    ...(isServer ? [[ending('service'), 1.2 * careless], [ending('foot_fault'), 0.3 * careless]] : []),
    [ending('two_bounce'), 0.6 * careless],
    [ending('net_touch'), 0.3],
    [ending('hit_by_ball'), 0.4],
    [ending('other_fault'), 0.2],
  ])
}
// A rally that ends on the serve never reaches a third shot.
const ENDS_ON_SERVE = new Set(['ace', 'service', 'foot_fault'])

/** One match, played out rally by rally. Null when it never resolves. */
function playMatch(sessionId, teamA, teamB, pointTarget, stacking, startedAt) {
  const match = {
    id: randomUUID(),
    sessionId,
    teamA: teamA.map((p) => p.id),
    teamB: teamB.map((p) => p.id),
    stacking,
    firstServer: { team: 'A', playerId: teamA[0].id },
    rightStart: { A: teamA[0].id, B: teamB[0].id },
    pointTarget,
  }
  const everyone = [...teamA, ...teamB]
  const events = []
  let clock = startedAt + rand(60_000, 100_000)
  let state = deriveMatchState({ ...match, events })

  for (let guard = 0; guard < 600 && !state.completed; guard += 1) {
    const serverId = currentServerPlayerId(state, match)
    // Stronger players both end more rallies and convert more of them,
    // so the result is an outcome of the play rather than decided first.
    const person = pick(everyone.map((p) => [p, p.ability ** 2]))
    const how = endingFor(person, person.id === serverId)
    const rally = {
      id: randomUUID(),
      type: 'rally',
      actingPlayerId: person.id,
      outcome: how.outcome,
      zone: how.zone,
      detail: how.key,
    }

    if (!ENDS_ON_SERVE.has(how.key) && chance(0.85)) {
      // The third shot belongs to the serving side.
      const serving = teamA.some((p) => p.id === serverId) ? teamA : teamB
      const hitter = sample(serving)
      const drop = chance(hitter.dropPreference)
      const third = {
        id: randomUUID(),
        seq: events.length,
        type: 'thirdShot',
        at: clock,
        playerId: hitter.id,
        shotType: drop ? 'drop' : 'drive',
        success: drop ? chance(hitter.dropLands) : null,
      }
      events.push(third)
      rally.thirdShotId = third.id
      clock += 8_000
    }
    events.push({ ...rally, seq: events.length, at: clock })
    clock += rand(9_000, 38_000)
    state = deriveMatchState({ ...match, events })
  }
  return state.completed ? { match, events, startedAt, endedAt: events.at(-1).at } : null
}

// ============================================================
// Each place: its history, then the nights it has missed
// ============================================================
const now = Date.now()
const places = []
for (const email of SEED_UMPIRES) {
  const { token, umpire } = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  const { sessions } = await call('/sessions', { token })
  const history = []
  for (const session of sessions.filter((s) => !s.voided_at)) {
    const { matches } = await call(`/matches/session/${session.id}`, { token })
    const played = matches.filter((m) => m.status === 'completed' && !m.voidedAt)
    if (played.length > 0) history.push({ name: session.name, matches: played })
  }
  places.push({ name: umpire.facilityName, token, history })
}

const newest = Math.max(...places.flatMap((p) => p.history.flatMap((s) => s.matches.map((m) => Date.parse(m.endedAt)))))
const fromDay = manilaDay(newest) + 1
const toDay = manilaDay(now)

const plan = []
for (const place of places) {
  const matches = place.history.flatMap((s) => s.matches)
  // Regulars turn up more often: weight each player by nights attended.
  const nightsOf = new Map()
  for (const session of place.history) {
    for (const id of new Set(session.matches.flatMap((m) => [...m.teamA, ...m.teamB]))) {
      nightsOf.set(id, (nightsOf.get(id) ?? 0) + 1)
    }
  }
  const singlesShare = matches.filter((m) => m.teamA.length === 1).length / matches.length
  const targets = matches.map((m) => m.pointTarget)
  const stackShare = matches.filter((m) => m.stacking?.A).length / matches.length

  // A named night ("Tuesday Open Play") keeps its weekday, its start
  // time and its usual gap between nights.
  for (const name of new Set(place.history.map((s) => s.name))) {
    const nights = place.history.filter((s) => s.name === name)
    const starts = nights.map((s) => Math.min(...s.matches.map((m) => Date.parse(m.startedAt)))).sort((a, b) => a - b)
    const days = starts.map(manilaDay)
    const gaps = days.slice(1).map((day, i) => day - days[i])
    const every = Math.max(7, Math.round((gaps.length ? median(gaps) : 7) / 7) * 7)
    const startOfDay = median(starts.map((ms) => (ms + MANILA_MS) % DAY_MS))

    for (let day = days.at(-1) + every; day <= toDay; day += every) {
      if (day < fromDay) continue
      const opensAt = day * DAY_MS - MANILA_MS + startOfDay + rand(-4, 4) * MIN
      if (opensAt > now) continue
      const like = sample(nights)
      const size = Math.max(4, new Set(like.matches.flatMap((m) => [...m.teamA, ...m.teamB])).size)
      const pool = [...nightsOf]
      const roster = []
      while (roster.length < size && pool.length > 0) {
        const chosen = pick(pool.map((entry) => [entry, entry[1]]))
        pool.splice(pool.indexOf(chosen), 1)
        roster.push({ ...traitsOf(chosen[0]), played: 0 })
      }
      plan.push({ place, name, opensAt, count: like.matches.length, roster, singlesShare, targets, stackShare })
    }
  }
}
plan.sort((a, b) => a.opensAt - b.opensAt)

// ============================================================
// Play each night and send it
// ============================================================
let sent = 0
for (const night of plan) {
  const sessionId = randomUUID()
  // More than a court can hold in an evening means two courts ran.
  const courts = Array.from({ length: night.count > 8 ? 2 : 1 }, () => night.opensAt + rand(0, 6) * MIN)
  const games = []
  for (let i = 0; i < night.count; i += 1) {
    const court = courts.indexOf(Math.min(...courts))
    const startedAt = courts[court]
    const singles = chance(night.singlesShare)
    // Whoever has sat out longest goes on next.
    const next = [...night.roster].sort((a, b) => a.played - b.played || Math.random() - 0.5).slice(0, singles ? 2 : 4)
    next.sort(() => Math.random() - 0.5)
    const half = next.length / 2
    const stacking = singles ? { A: false, B: false } : { A: chance(night.stackShare), B: chance(night.stackShare) }
    const game = playMatch(sessionId, next.slice(0, half), next.slice(half), sample(night.targets), stacking, startedAt)
    if (!game || game.endedAt > now) continue
    for (const person of next) person.played += 1
    courts[court] = game.endedAt + rand(1.5, 5) * MIN
    games.push(game)
  }

  const when = new Date(night.opensAt + MANILA_MS).toUTCString().slice(0, 22)
  console.log(`${when}  ${night.place.name} · ${night.name}: ${games.length} matches, ${night.roster.length} players`)
  if (DRY || games.length === 0) continue

  const { token } = night.place
  await call('/sessions', { method: 'POST', token, body: { id: sessionId, name: night.name } })
  await call(`/sessions/${sessionId}/players`, { method: 'PUT', token, body: { playerIds: night.roster.map((p) => p.id) } })
  for (const { match, events, startedAt } of games) {
    await call('/matches', { method: 'POST', token, body: { ...match, startedAt } })
    await call(`/matches/${match.id}/log`, { method: 'PUT', token, body: { deviceId: DEVICE, events } })
    sent += 1
  }
  // A night that is over is closed, so it never sits on the Overview's
  // left-open list.
  await call(`/sessions/${sessionId}/end`, { method: 'POST', token })
}

console.log(DRY ? `Dry run: ${plan.length} nights planned, nothing sent.` : `Sent ${sent} matches across ${plan.length} nights.`)
if (!DRY && sent > 0) console.log('Playstyles are from the last ML run; start one (POST /run on the ml service) to refresh them.')
