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

if (!pattern) {
  console.error('usage: cleanup-test-data.mjs <umpire-email-pattern>')
  console.error("example: cleanup-test-data.mjs 'smoke.%@example.com'")
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

console.log(
  `\ndeleted: ${sessions.rowCount} sessions, ${players.rowCount} players, ` +
    `${invites.rowCount} invites, ${gone.rowCount} umpires`,
)

const { rows: left } = await pool.query(
  `SELECT (SELECT count(*)::int FROM umpires)  AS umpires,
          (SELECT count(*)::int FROM players)  AS players,
          (SELECT count(*)::int FROM sessions) AS sessions,
          (SELECT count(*)::int FROM matches)  AS matches`,
)
console.log('remaining:', JSON.stringify(left[0]))

await pool.end()
