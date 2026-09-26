#!/usr/bin/env node
// ============================================================
// Dumps every table as JSON on stdout. Read-only.
//
//   railway ssh --service api --environment production -- \
//     node scripts/backup-data.mjs > backup.json
//
// Runs before anything destructive. The data here is small enough that
// a JSON dump is a complete backup rather than a summary, and stdout is
// the point: the file lands on YOUR machine, not on the container's
// disk, which is thrown away on the next deploy.
//
// SENSITIVE. The dump contains umpire and admin password hashes and
// player claim codes -- a claim code is a bearer credential, so anyone
// holding this file can claim those players. Keep it off shared drives
// and delete it once you no longer need it.
// ============================================================

import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const TABLES = [
  'facilities',
  'facility_logos',
  'umpires',
  'admins',
  'admin_setup_links',
  'admin_activity',
  'admin_backup_codes',
  'invites',
  'players',
  'sessions',
  'session_players',
  'matches',
  'match_events',
]

const dump = { takenAt: new Date().toISOString(), tables: {} }

for (const table of TABLES) {
  const { rows } = await pool.query(`SELECT * FROM ${table}`)
  // Pictures (facility_logos) as base64 text: a Buffer would otherwise
  // be written out as one JSON number per byte.
  dump.tables[table] = rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? value.toString('base64') : value]),
  ))
}

// Counts on stderr so they're visible even while stdout is redirected
// into the backup file.
for (const [table, rows] of Object.entries(dump.tables)) {
  console.error(`  ${table.padEnd(16)} ${rows.length}`)
}

console.log(JSON.stringify(dump, null, 2))
await pool.end()
