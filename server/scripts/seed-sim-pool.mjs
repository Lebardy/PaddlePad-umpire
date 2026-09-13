#!/usr/bin/env node
// ============================================================
// A synthetic player pool with its true abilities written down.
//
//   UMPIRE_TOKEN=... node server/scripts/seed-sim-pool.mjs https://api-staging-8ac6.up.railway.app [players] [matchesPerPlayer]
//
// STAGING ONLY. Goes through the API with an umpire session -- no
// database credentials -- so every match passes the same validation as
// one scored courtside. Each player has a hidden ability and style; who
// ends each rally, whether it is a winner, and HOW it ended all follow
// from them, so a rating can be checked against the truth.
//
// Voids the older "Seeded pool (synthetic)" session so the two pools do
// not mix in ratings or the export, and writes the hidden abilities to
// server/scripts/.sim-pool-truth.json (never to the database).
// ============================================================

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentServerPlayerId, deriveMatchState } from '../src/pickleball.js'
import { RALLY_ENDINGS } from '../src/rally-endings.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN || !/staging|localhost|127\.0\.0\.1/.test(API)) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/seed-sim-pool.mjs <STAGING_API_URL> [players] [matchesPerPlayer]')
  console.error('Refuses any API that is not staging or local.')
  process.exit(2)
}
const PLAYERS = Number(process.argv[3] ?? 50)
const PER_PLAYER = Number(process.argv[4] ?? 8)
const SESSION_NAME = 'Simulated pool (synthetic)'
const OLD_SESSION_NAME = 'Seeded pool (synthetic)'
const DEVICE = `sim-${randomUUID().slice(0, 8)}`
const here = dirname(fileURLToPath(import.meta.url))

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok && response.status !== 409) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
  return { status: response.status, data }
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo)
const chance = (p) => Math.random() < p
const pick = (weighted) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  for (const [value, w] of weighted) {
    roll -= w
    if (roll <= 0) return value
  }
  return weighted[weighted.length - 1][0]
}

// ---- Retire the older pool ----
const { data: listed } = await call('/sessions')
for (const old of listed.sessions.filter((s) => s.name === OLD_SESSION_NAME || s.name === SESSION_NAME)) {
  if (!old.voided_at) {
    await call(`/sessions/${old.id}/void`, { method: 'POST', body: { reason: 'Replaced by a regenerated synthetic pool' } })
    console.log(`voided session "${old.name}"`)
  }
}

// ---- Players ----
const FIRST = ['Ana', 'Ben', 'Cara', 'Dev', 'Elle', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jae', 'Kit', 'Lena', 'Mo',
  'Nia', 'Omar', 'Pia', 'Quin', 'Rey', 'Sam', 'Tara', 'Uma', 'Vic', 'Wes', 'Xena', 'Yuri', 'Zoe']
const LAST = ['Cruz', 'Reyes', 'Santos', 'Lim', 'Tan', 'Diaz', 'Uy', 'Chua', 'Bautista', 'Ramos']
const stamp = new Date().toISOString().slice(5, 10)
const people = []
for (let i = 0; i < PLAYERS; i += 1) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${stamp} (sim)`
  const { status, data } = await call('/players', { method: 'POST', body: { name } })
  const player = status === 409 ? data.player : data.player
  people.push({
    id: player.id,
    name: player.name,
    ability: rand(0.25, 0.85),
    netPlay: rand(0.15, 0.8),
    dropPreference: rand(0.2, 0.9),
  })
}

// ---- Session and roster ----
const sessionId = randomUUID()
await call('/sessions', { method: 'POST', body: { id: sessionId, name: SESSION_NAME } })
await call(`/sessions/${sessionId}/players`, { method: 'PUT', body: { playerIds: people.map((p) => p.id) } })

// ---- How a rally ends, from who ended it ----
const WINNERS = RALLY_ENDINGS.filter((e) => e.outcome === 'winner')
const FAULTS = RALLY_ENDINGS.filter((e) => e.outcome === 'error')

function endingFor(person, isServer) {
  const won = chance(person.ability)
  const atNet = chance(person.netPlay)
  if (won) {
    if (atNet) return WINNERS.find((e) => e.key === 'dink_winner')
    return pick([
      ...(isServer ? [[WINNERS.find((e) => e.key === 'ace'), 0.6]] : []),
      [WINNERS.find((e) => e.key === 'putaway'), 3],
      [WINNERS.find((e) => e.key === 'passing'), 2],
      [WINNERS.find((e) => e.key === 'lob'), 0.8],
      [WINNERS.find((e) => e.key === 'drop_winner'), 1.2],
      [WINNERS.find((e) => e.key === 'other_winner'), 0.4],
    ])
  }
  if (atNet) return pick([[FAULTS.find((e) => e.key === 'dink_error'), 3], [FAULTS.find((e) => e.key === 'kitchen'), 1]])
  // Weaker players make more of the self-inflicted faults.
  const careless = 1 - person.ability
  return pick([
    [FAULTS.find((e) => e.key === 'out'), 3],
    [FAULTS.find((e) => e.key === 'net'), 3],
    ...(isServer
      ? [[FAULTS.find((e) => e.key === 'service'), 1.2 * careless], [FAULTS.find((e) => e.key === 'foot_fault'), 0.3 * careless]]
      : []),
    [FAULTS.find((e) => e.key === 'two_bounce'), 0.6 * careless],
    [FAULTS.find((e) => e.key === 'net_touch'), 0.3],
    [FAULTS.find((e) => e.key === 'hit_by_ball'), 0.4],
    [FAULTS.find((e) => e.key === 'other_fault'), 0.2],
  ])
}

// ---- Matches ----
const rounds = Math.ceil((PLAYERS * PER_PLAYER) / (4 * Math.floor(PLAYERS / 4)))
const start = Date.now() - rounds * 12 * 90 * 60_000
let played = 0
let dropped = 0

for (let round = 0; round < rounds; round += 1) {
  const shuffled = [...people].sort(() => Math.random() - 0.5)
  for (let i = 0; i + 3 < shuffled.length; i += 4) {
    const [a1, a2, b1, b2] = shuffled.slice(i, i + 4)
    const four = [a1, a2, b1, b2]
    const match = {
      id: randomUUID(),
      sessionId,
      teamA: [a1.id, a2.id],
      teamB: [b1.id, b2.id],
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: a1.id },
      rightStart: { A: a1.id, B: b1.id },
      pointTarget: 11,
    }
    const startedAt = start + played * 90 * 60_000
    const events = []
    const weights = four.map((p) => p.ability ** 2)
    const totalWeight = weights.reduce((s, w) => s + w, 0)
    const actor = () => {
      let roll = Math.random() * totalWeight
      for (let j = 0; j < 4; j += 1) {
        roll -= weights[j]
        if (roll <= 0) return four[j]
      }
      return four[3]
    }

    let state = deriveMatchState({ ...match, events })
    for (let guard = 0; guard < 400 && !state.completed; guard += 1) {
      const serverId = currentServerPlayerId(state, match)
      const person = actor()
      const ending = endingFor(person, person.id === serverId)
      events.push({
        id: randomUUID(),
        seq: events.length,
        type: 'rally',
        at: startedAt + (events.length + 1) * 25_000,
        actingPlayerId: person.id,
        outcome: ending.outcome,
        zone: ending.zone,
        detail: ending.key,
      })
      state = deriveMatchState({ ...match, events })
    }
    if (!state.completed) {
      dropped += 1
      continue
    }

    await call('/matches', { method: 'POST', body: { ...match, startedAt } })
    await call(`/matches/${match.id}/log`, { method: 'PUT', body: { deviceId: DEVICE, events } })
    played += 1
  }
}

writeFileSync(
  join(here, '.sim-pool-truth.json'),
  JSON.stringify({ session: SESSION_NAME, players: people }, null, 2),
)
console.log(`Seeded ${people.length} players and ${played} completed matches in "${SESSION_NAME}".`)
if (dropped) console.log(`(${dropped} generated matches never resolved and were not sent.)`)
console.log('True abilities written to server/scripts/.sim-pool-truth.json')
