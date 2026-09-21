#!/usr/bin/env node
// ============================================================
// Seeds a CLUB-SIZED pool of players so the ML pipeline has something
// real to cluster.
//
//   node scripts/seed-pool.mjs [players] [matchesPerPlayer]
//   node scripts/seed-pool.mjs --remove
//
// WARNING: this writes REAL players and REAL matches. Only ever point it
// at staging or a local test database. It refuses to run against a
// database that already holds matches outside its own session, so it
// cannot quietly inflate a real club's data.
//
// Separate from seed-demo.mjs on purpose. That script makes ONE player's
// app look good -- every match involves them. This one needs the
// opposite: many players, each with their own history, none of them
// central. Merging the two would give a script with a flag that changes
// what it fundamentally is.
//
// Each seeded player gets a hidden ability and a hidden style, and every
// rally is resolved through the real scoring engine. So stronger players
// genuinely win more rather than being labelled as stronger -- which
// means the pipeline's skill scores can be checked against the abilities
// they were generated from, instead of only checked for being
// well-formed.
// ============================================================

import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { deriveMatchState } from '../src/pickleball.js'

const SESSION_NAME = 'Seeded pool (synthetic)'
// Marks every player this script creates, so --remove can find them
// again and so nobody mistakes one for a real person on a roster.
const NAME_SUFFIX = '(seed)'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')
    ? false
    : { rejectUnauthorized: false },
})

if (process.argv[2] === '--remove') {
  await pool.query('DELETE FROM sessions WHERE name = $1', [SESSION_NAME])
  const gone = await pool.query('DELETE FROM players WHERE name LIKE $1', [`%${NAME_SUFFIX}`])
  console.log(`Removed the seeded session and ${gone.rowCount} seeded player(s).`)
  console.log('Ratings computed from them stay behind as snapshots; drop those with:')
  console.log("  DELETE FROM rating_runs WHERE notes->'gate' IS NOT NULL;")
  await pool.end()
  process.exit(0)
}

const PLAYERS = Number(process.argv[2] ?? 50)
const PER_PLAYER = Number(process.argv[3] ?? 8)

// The pipeline's practical floor. Below roughly forty players the
// two-level clustering starts skipping groups and the archetype half of
// the result stops being produced, so seeding fewer would demonstrate
// the gate rather than the pipeline.
if (PLAYERS < 40) {
  console.warn(`Warning: ${PLAYERS} players is below the ~40 the clustering wants.`)
}

// ============================================================
// Refuse to touch a database with real play in it
// ============================================================
const { rows: existing } = await pool.query(
  `SELECT count(*)::int AS n FROM matches m
     JOIN sessions s ON s.id = m.session_id
    WHERE s.name <> $1`,
  [SESSION_NAME],
)
if (existing[0].n > 0) {
  console.error(
    `Refusing to run: this database already has ${existing[0].n} match(es) that\n` +
      'this script did not create. Seeding a synthetic pool alongside real play\n' +
      'would put invented players into the ratings of real ones, and nothing\n' +
      'downstream could tell them apart afterwards.\n\n' +
      'Use a staging or local database.',
  )
  process.exit(1)
}

const { rows: umpires } = await pool.query(
  'SELECT id, facility_id FROM umpires ORDER BY created_at LIMIT 1',
)
const recordedBy = umpires[0]?.id ?? null
const facilityId = umpires[0]?.facility_id ?? null

if (!facilityId) {
  console.error(
    'The oldest umpire has no facility, so the seeded session would be\n' +
    'invisible in the umpire app. Make a facility and put an umpire in it first.',
  )
  process.exit(1)
}

// ============================================================
// Hidden profiles
//
// The pipeline can only find structure that is there, so the pool is
// generated with structure in it: ability drives who wins rallies, and
// style drives HOW they win them. Uniform noise would leave K-Means
// nothing to find, and the demo would then show the pipeline failing
// honestly rather than working.
// ============================================================
const FIRST = ['Ana', 'Ben', 'Cara', 'Dev', 'Elle', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jae',
  'Kit', 'Lena', 'Mo', 'Nia', 'Omar', 'Pia', 'Quin', 'Rey', 'Sam', 'Tara',
  'Uma', 'Vic', 'Wes', 'Xena', 'Yuri', 'Zoe']
const LAST = ['Cruz', 'Reyes', 'Santos', 'Lim', 'Tan', 'Diaz', 'Uy', 'Chua', 'Bautista', 'Ramos']

const rand = (lo, hi) => lo + Math.random() * (hi - lo)
const chance = (p) => Math.random() < p

const people = []
for (let i = 0; i < PLAYERS; i += 1) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${
    i >= FIRST.length * LAST.length ? i : ''
  } ${NAME_SUFFIX}`
  people.push({
    id: randomUUID(),
    name,
    // How often their shots end the rally in their favour.
    ability: rand(0.25, 0.85),
    // How much of their game happens at the net. Independent of ability
    // on purpose -- that independence is exactly what the residualizing
    // step in the pipeline exists to preserve, and a pool where style
    // tracked skill would make the archetypes meaningless.
    netPlay: rand(0.15, 0.8),
    // Drop versus drive as the third shot.
    dropPreference: rand(0.2, 0.9),
    stacks: chance(0.3),
  })
}

for (const person of people) {
  await pool.query(
    'INSERT INTO players (id, name, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [person.id, person.name, recordedBy],
  )
}

await pool.query('DELETE FROM sessions WHERE name = $1', [SESSION_NAME])
const sessionId = randomUUID()
await pool.query(
  'INSERT INTO sessions (id, name, created_by, facility_id) VALUES ($1, $2, $3, $4)',
  [sessionId, SESSION_NAME, recordedBy, facilityId],
)
for (const person of people) {
  await pool.query(
    'INSERT INTO session_players (session_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [sessionId, person.id],
  )
}

// ============================================================
// Matches
// ============================================================

/** Rotates through the pool so everyone gets a similar number of matches. */
function* courts(count) {
  const order = []
  for (let round = 0; round < count; round += 1) {
    const shuffled = [...people].sort(() => Math.random() - 0.5)
    for (let i = 0; i + 3 < shuffled.length; i += 4) {
      order.push(shuffled.slice(i, i + 4))
    }
  }
  yield* order
}

const now = Date.now()
let seeded = 0
let abandoned = 0

// Four players per match, so this many matches gives each player roughly
// PER_PLAYER of them.
const rounds = Math.ceil((PLAYERS * PER_PLAYER) / (4 * Math.floor(PLAYERS / 4)))

for (const four of courts(rounds)) {
  const [a1, a2, b1, b2] = four
  const teamA = [a1.id, a2.id]
  const teamB = [b1.id, b2.id]
  const matchId = randomUUID()
  const pointTarget = 11

  const events = []
  const push = (type, payload) =>
    events.push({ id: randomUUID(), seq: events.length, type, payload })

  // Third shots first, one batch per player, in their own proportion of
  // drops to drives. This is what gives drop_efficiency and
  // drop_preference_rate something to differ on between players.
  for (const person of four) {
    const attempts = 4 + Math.floor(Math.random() * 8)
    for (let i = 0; i < attempts; i += 1) {
      if (chance(person.dropPreference)) {
        push('thirdShot', {
          playerId: person.id,
          shotType: 'drop',
          // Better players land more of them.
          success: chance(0.35 + person.ability * 0.5),
        })
      } else {
        push('thirdShot', { playerId: person.id, shotType: 'drive', success: null })
      }
    }
  }

  // Then rallies until someone wins. Who acts is weighted by ability, so
  // stronger players both hit more shots and convert more of them --
  // and the match result is an OUTCOME of that rather than decided up
  // front and worked backwards from.
  const weights = four.map((p) => p.ability ** 2)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const actor = () => {
    let roll = Math.random() * totalWeight
    for (let i = 0; i < four.length; i += 1) {
      roll -= weights[i]
      if (roll <= 0) return four[i]
    }
    return four[3]
  }

  let guard = 0
  while (guard++ < 400) {
    const state = deriveMatchState({
      teamA,
      teamB,
      firstServer: { team: 'A', playerId: a1.id },
      pointTarget,
      events: events.map((e) => ({ type: e.type, ...e.payload })),
    })
    if (state.completed) break

    const person = actor()
    push('rally', {
      actingPlayerId: person.id,
      outcome: chance(person.ability) ? 'winner' : 'error',
      zone: chance(person.netPlay) ? 'dink' : 'open',
    })
  }

  const final = deriveMatchState({
    teamA,
    teamB,
    firstServer: { team: 'A', playerId: a1.id },
    pointTarget,
    events: events.map((e) => ({ type: e.type, ...e.payload })),
  })
  // A match that never resolved is dropped rather than written as a tie.
  // Under side-out rules an unlucky sequence really can stall, and
  // storing those would feed the pipeline durations and rates from
  // games that did not happen.
  if (!final.completed) {
    abandoned += 1
    continue
  }

  const startedAt = new Date(now - (rounds * 4 - seeded) * 90 * 60_000)
  const durationMins = 18 + Math.floor(Math.random() * 16)
  const endedAt = new Date(startedAt.getTime() + durationMins * 60_000)

  await pool.query(
    `INSERT INTO matches (id, session_id, recorded_by, team_a, team_b,
                          stacking_a, stacking_b, first_server_team,
                          first_server_player, point_target, status, winner,
                          started_at, ended_at)
     VALUES ($1,$2,$3,$4::uuid[],$5::uuid[],$6,$7,'A',$8,$9,'completed',$10,$11,$12)`,
    [
      matchId, sessionId, recordedBy, teamA, teamB,
      a1.stacks, b1.stacks, a1.id, pointTarget, final.winner,
      startedAt.toISOString(), endedAt.toISOString(),
    ],
  )

  // One statement for the whole match rather than one per event: a
  // 50-player pool is a few thousand events, and a round trip each
  // turns a fast script into a slow one.
  const values = []
  const params = []
  for (const event of events) {
    const base = params.length
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::jsonb,$${base + 6})`)
    params.push(
      event.id, matchId, event.seq, event.type,
      JSON.stringify(event.payload),
      new Date(startedAt.getTime() + event.seq * 20_000).toISOString(),
    )
  }
  await pool.query(
    `INSERT INTO match_events (id, match_id, seq, type, payload, at) VALUES ${values.join(',')}`,
    params,
  )

  seeded += 1
}

const { rows: counts } = await pool.query(
  `SELECT count(*)::int AS qualifying FROM (
     SELECT p.id FROM players p
       JOIN matches m ON (m.team_a @> ARRAY[p.id]::uuid[] OR m.team_b @> ARRAY[p.id]::uuid[])
      WHERE m.status = 'completed' AND m.voided_at IS NULL
      GROUP BY p.id HAVING count(*) >= 5
   ) q`,
)

console.log(`Seeded ${PLAYERS} players and ${seeded} completed matches.`)
if (abandoned > 0) console.log(`(${abandoned} generated matches never resolved and were dropped.)`)
console.log(`${counts[0].qualifying} players now clear the 5-match gate.`)
console.log('')
console.log(`Everything lives in the session "${SESSION_NAME}" and players named "... ${NAME_SUFFIX}".`)
console.log('Remove it all with:  node scripts/seed-pool.mjs --remove')

await pool.end()
