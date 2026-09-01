#!/usr/bin/env node
// ============================================================
// Removes everything a given TEST umpire created, and nothing else.
//
//   railway ssh --service api -- node scripts/cleanup-test-data.mjs <email-pattern>
//
// Written after a near-miss: test cleanups used to delete by matching
// session and player NAMES, which is one careless pattern away from
// destroying someone's real records. Ownership is the safe key --
// sessions.created_by, players.created_by and matches.recorded_by all
// point at the umpire who made them, so scoping deletes to a test
// umpire's own id CANNOT reach data a real umpire created, whatever the
// records happen to be called.
//
// Refuses to run without an explicit pattern, and refuses patterns
// broad enough to match real accounts.
// ============================================================

import pg from 'pg'

const pattern = process.argv[2]

// Players who registered THEMSELVES, passed explicitly by id.
//
// The ownership key this script is built on cannot reach them: a
// self-registered player has created_by IS NULL by definition, because
// no umpire created them. The smoke test prints the ids it registered
// and they are handed back here.
//
// Still by id, never by name -- the rule in the header holds. The extra
// guard below is that any id with a single recorded match is refused,
// because an id typed by hand is the one input here that could name a
// real person, and real recorded play is precisely what this script
// must be unable to touch.
const selfRegistered = (process.argv[3] ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (!pattern) {
  console.error('usage: cleanup-test-data.mjs <umpire-email-pattern> [self-registered-player-ids]')
  console.error("example: cleanup-test-data.mjs 'smoke.%@example.com'")
  console.error("example: cleanup-test-data.mjs 'smoke.%@example.com' 1f2e...,3a4b...")
  process.exit(1)
}

// A pattern that could match a real account is refused outright. Test
// umpires are always created at example.com, which is reserved by RFC
// 2606 and can never be a real address.
if (!pattern.includes('@example.com') || pattern === '%@example.com') {
  console.error(
    'Refusing: pattern must target a specific test account at @example.com.\n' +
      'Real umpire accounts must be unreachable from this script.',
  )
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const { rows: umpires } = await pool.query(
  'SELECT id, email FROM umpires WHERE email LIKE $1',
  [pattern],
)

if (umpires.length === 0) {
  console.log(`No umpires match ${pattern}; nothing to do.`)
  await pool.end()
  process.exit(0)
}

console.log(`Removing data created by ${umpires.length} test umpire(s):`)
umpires.forEach((u) => console.log('   ', u.email))

const ids = umpires.map((u) => u.id)

// Order matters only for readability -- sessions cascade to matches and
// match_events, and session_players cascades from both sides.
const sessions = await pool.query(
  'DELETE FROM sessions WHERE created_by = ANY($1::uuid[])',
  [ids],
)
const players = await pool.query(
  'DELETE FROM players WHERE created_by = ANY($1::uuid[])',
  [ids],
)
const invites = await pool.query(
  'DELETE FROM invites WHERE created_by = ANY($1::uuid[]) OR used_by = ANY($1::uuid[])',
  [ids],
)
const gone = await pool.query('DELETE FROM umpires WHERE id = ANY($1::uuid[])', [ids])

let selfGone = 0
if (selfRegistered.length > 0) {
  const { rows: candidates } = await pool.query(
    `SELECT p.id,
            p.name,
            p.created_by,
            count(m.id)::int AS match_count
       FROM players p
       LEFT JOIN matches m
         ON (p.id = ANY (m.team_a) OR p.id = ANY (m.team_b))
      WHERE p.id = ANY($1::uuid[])
      GROUP BY p.id`,
    [selfRegistered],
  )

  const safe = []
  for (const row of candidates) {
    if (row.match_count > 0) {
      console.error(
        `\nRefusing to delete ${row.name}: ${row.match_count} recorded match(es).\n` +
          'This script never deletes a player with real play behind them.',
      )
      continue
    }
    if (row.created_by !== null) {
      // Owned by an umpire, so the ownership pass above is the right
      // route and this one has no business second-guessing it.
      continue
    }
    safe.push(row.id)
  }

  if (safe.length > 0) {
    const result = await pool.query('DELETE FROM players WHERE id = ANY($1::uuid[])', [safe])
    selfGone = result.rowCount
  }
}

console.log(
  `\ndeleted: ${sessions.rowCount} sessions, ${players.rowCount} players, ` +
    `${invites.rowCount} invites, ${gone.rowCount} umpires` +
    (selfRegistered.length ? `, ${selfGone} self-registered players` : ''),
)

const { rows: left } = await pool.query(
  `SELECT (SELECT count(*)::int FROM umpires)  AS umpires,
          (SELECT count(*)::int FROM players)  AS players,
          (SELECT count(*)::int FROM sessions) AS sessions,
          (SELECT count(*)::int FROM matches)  AS matches`,
)
console.log('remaining:', JSON.stringify(left[0]))

await pool.end()
