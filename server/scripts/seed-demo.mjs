#!/usr/bin/env node
// ============================================================
// Seeds realistic demo matches so the player app can be looked at with
// data in it, and removes them again cleanly.
//
//   node scripts/seed-demo.mjs "Jan Librando" [matches]
//   node scripts/seed-demo.mjs --remove
//
// WARNING: this writes REAL matches to the live database. They count in
// the ML export like any other match until removed. Everything it
// creates goes in one clearly-named session so --remove can take it all
// back out with nothing left behind.
//
// Scores are driven through the real scoring engine rather than being
// written directly. Under side-out rules a won rally only scores if
// your team was serving, so anything that just alternates winners
// produces side-outs and matches that never finish -- a naive generator
// gave 0-2 with seven ties before this was fixed.
// ============================================================

import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { deriveMatchState } from '../src/pickleball.js'

const SESSION_NAME = 'Demo data (seeded)'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

if (process.argv[2] === '--remove') {
  const { rows } = await pool.query(
    'SELECT id FROM sessions WHERE name = $1',
    [SESSION_NAME],
  )
  if (rows.length === 0) {
    console.log('No demo session found; nothing to remove.')
  } else {
    // Sessions cascade to matches and match_events.
    const gone = await pool.query('DELETE FROM sessions WHERE name = $1', [SESSION_NAME])
    console.log(`Removed ${gone.rowCount} demo session(s) and everything in them.`)
    console.log('Your players are untouched -- only the seeded matches are gone.')
  }
  await pool.end()
  process.exit(0)
}

const subjectName = process.argv[2]
const wanted = Number(process.argv[3] ?? 12)

if (!subjectName) {
  console.error('usage: seed-demo.mjs "<player name>" [matches]   |   seed-demo.mjs --remove')
  process.exit(1)
}

const { rows: everyone } = await pool.query(
  'SELECT id, name FROM players ORDER BY created_at',
)
const subject = everyone.find(
  (p) => p.name.toLowerCase() === subjectName.toLowerCase(),
)
if (!subject) {
  console.error(`No player called "${subjectName}". Known: ${everyone.map((p) => p.name).join(', ')}`)
  process.exit(1)
}
const others = everyone.filter((p) => p.id !== subject.id)
if (others.length < 3) {
  console.error(`Need at least 4 players for doubles; found ${everyone.length}.`)
  process.exit(1)
}

const { rows: umpires } = await pool.query(
  'SELECT id FROM umpires ORDER BY created_at LIMIT 1',
)
const recordedBy = umpires[0]?.id ?? null

// One session holding everything, so removal is a single delete.
await pool.query('DELETE FROM sessions WHERE name = $1', [SESSION_NAME])
const sessionId = randomUUID()
await pool.query(
  'INSERT INTO sessions (id, name, created_by) VALUES ($1, $2, $3)',
  [sessionId, SESSION_NAME, recordedBy],
)
for (const p of everyone) {
  await pool.query(
    'INSERT INTO session_players (session_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [sessionId, p.id],
  )
}

const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n)
const chance = (p) => Math.random() < p

let seeded = 0
// Spread the matches over recent weeks so the history reads like a
// season rather than everything landing in one minute.
const now = Date.now()

for (let i = 0; i < wanted; i += 1) {
  const [partner, oppA, oppB] = pick(others, 3)
  // The subject is stronger than average but not unbeatable -- a
  // flawless record tells you nothing about how the app handles losses.
  const subjectWins = chance(0.65)
  const theirTarget = subjectWins ? 3 + Math.floor(Math.random() * 7) : 11
  const myTarget = subjectWins ? 11 : 2 + Math.floor(Math.random() * 8)

  const teamA = [subject.id, partner.id]
  const teamB = [oppA.id, oppB.id]
  const matchId = randomUUID()

  const startedAt = new Date(now - (wanted - i) * 3 * 86_400_000 - 40 * 60_000)
  const events = []
  const push = (type, payload) =>
    events.push({ id: randomUUID(), seq: events.length, type, payload })

  // A realistic mix of third shots before the rallies.
  const dropAttempts = 3 + Math.floor(Math.random() * 6)
  const dropSuccesses = Math.round(dropAttempts * (0.5 + Math.random() * 0.4))
  for (let d = 0; d < dropAttempts; d += 1)
    push('thirdShot', { playerId: subject.id, shotType: 'drop', success: d < dropSuccesses })
  for (let d = 0; d < 1 + Math.floor(Math.random() * 4); d += 1)
    push('thirdShot', { playerId: subject.id, shotType: 'drive', success: null })

  const dinkShare = 0.25 + Math.random() * 0.3
  let guard = 0
  while (guard++ < 300) {
    const state = deriveMatchState({
      teamA,
      teamB,
      firstServer: { team: 'A', playerId: subject.id },
      events: events.map((e) => ({ type: e.type, ...e.payload })),
    })
    if (state.completed) break
    const need = { A: state.score.A < myTarget, B: state.score.B < theirTarget }
    if (!need.A && !need.B) break

    const serving = state.servingTeam
    const other = serving === 'A' ? 'B' : 'A'
    // The serving side usually converts, but not always -- always
    // converting would run every game to 11-0 before the other side
    // ever served.
    const winner = !need[serving] ? other : need[other] && chance(0.4) ? other : serving

    if (winner === 'A') {
      if (chance(0.7)) {
        push('rally', {
          actingPlayerId: subject.id,
          outcome: 'winner',
          zone: chance(dinkShare) ? 'dink' : 'open',
        })
      } else {
        push('rally', { actingPlayerId: oppA.id, outcome: 'error', zone: 'open' })
      }
    } else if (chance(0.45)) {
      push('rally', {
        actingPlayerId: subject.id,
        outcome: 'error',
        zone: chance(0.35) ? 'dink' : 'open',
      })
    } else {
      push('rally', { actingPlayerId: oppA.id, outcome: 'winner', zone: 'open' })
    }
  }

  const final = deriveMatchState({
    teamA,
    teamB,
    firstServer: { team: 'A', playerId: subject.id },
    events: events.map((e) => ({ type: e.type, ...e.payload })),
  })
  // Only keep matches that actually finished on court -- a seeded pile
  // of unresolved ties would misrepresent how the app really looks.
  if (!final.completed) continue

  const durationMins = 22 + Math.floor(Math.random() * 20)
  const endedAt = new Date(startedAt.getTime() + durationMins * 60_000)

  await pool.query(
    `INSERT INTO matches (id, session_id, recorded_by, team_a, team_b,
                          stacking_a, stacking_b, first_server_team,
                          first_server_player, status, winner, started_at, ended_at)
     VALUES ($1,$2,$3,$4::uuid[],$5::uuid[],$6,$7,'A',$8,'completed',$9,$10,$11)`,
    [
      matchId, sessionId, recordedBy, teamA, teamB,
      chance(0.3), chance(0.2), subject.id, final.winner,
      startedAt.toISOString(), endedAt.toISOString(),
    ],
  )

  for (const event of events) {
    await pool.query(
      `INSERT INTO match_events (id, match_id, seq, type, payload, at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        event.id, matchId, event.seq, event.type,
        JSON.stringify(event.payload),
        new Date(startedAt.getTime() + event.seq * 25_000).toISOString(),
      ],
    )
  }
  seeded += 1
}

console.log(`Seeded ${seeded} completed matches for ${subject.name}.`)
console.log(`All of it lives in the session "${SESSION_NAME}".`)
console.log('')
console.log('These count in the CSV export like any other match.')
console.log('Remove them with:  node scripts/seed-demo.mjs --remove')

await pool.end()
