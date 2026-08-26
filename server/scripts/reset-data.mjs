#!/usr/bin/env node
// ============================================================
// Clears out a database, keeping exactly one umpire account and one
// player record.
//
//   node scripts/reset-data.mjs --umpire <email> --player <name>
//   node scripts/reset-data.mjs --umpire <email> --player <name> --confirm
//
// Without --confirm it only reports what it WOULD delete, and that is
// the intended way to run it first.
//
// Everything else goes: all other umpire accounts, all other players,
// every session, every match and every event, and all invite codes.
// The two survivors keep the things that let them sign in -- the
// umpire's password hash, the player's claim code -- so both logins
// still work afterwards against an otherwise empty database.
//
// This is not recoverable. Take a backup first:
//   node scripts/backup-data.mjs > backup.json
//
// WHY IT MATCHES ON EXACT VALUES, AND REFUSES OTHERWISE
//
// A pattern that matched nothing would delete everything, and a pattern
// that matched two people would keep a stranger. So both selectors must
// resolve to exactly one row or the script aborts having changed
// nothing. This is the same reasoning as cleanup-test-data.mjs: make
// the destructive path unable to act on a guess.
// ============================================================

import pg from 'pg'

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : process.argv[i + 1]
}

const keepUmpireEmail = arg('--umpire')
const keepPlayerName = arg('--player')
const confirmed = process.argv.includes('--confirm')

if (!keepUmpireEmail || !keepPlayerName) {
  console.error(
    'usage: reset-data.mjs --umpire <email> --player <name> [--confirm]\n' +
      '\nBoth must match exactly one existing row.',
  )
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// Compared case-insensitively, the same way the login and the player
// registry compare them, so the caller doesn't have to reproduce the
// exact casing that happens to be stored.
const { rows: umpires } = await pool.query(
  'SELECT id, name, email FROM umpires WHERE lower(email) = lower($1)',
  [keepUmpireEmail],
)
const { rows: players } = await pool.query(
  'SELECT id, name FROM players WHERE lower(name) = lower($1)',
  [keepPlayerName],
)

function requireExactlyOne(rows, what, value) {
  if (rows.length === 1) return rows[0]
  console.error(
    rows.length === 0
      ? `\nNo ${what} matches "${value}". Nothing has been changed.\n` +
          'Run scripts/backup-data.mjs to see what actually exists.'
      : `\n${rows.length} ${what}s match "${value}". Nothing has been changed.`,
  )
  process.exit(1)
}

const umpire = requireExactlyOne(umpires, 'umpire', keepUmpireEmail)
const player = requireExactlyOne(players, 'player', keepPlayerName)

console.log('\nKeeping:')
console.log(`  umpire  ${umpire.name} <${umpire.email}>`)
console.log(`  player  ${player.name}`)

const { rows: doomed } = await pool.query(
  `SELECT (SELECT count(*)::int FROM umpires WHERE id <> $1)      AS umpires,
          (SELECT count(*)::int FROM players WHERE id <> $2)      AS players,
          (SELECT count(*)::int FROM sessions)                    AS sessions,
          (SELECT count(*)::int FROM matches)                     AS matches,
          (SELECT count(*)::int FROM match_events)                AS events,
          (SELECT count(*)::int FROM invites)                     AS invites`,
  [umpire.id, player.id],
)

console.log('\nDeleting:')
for (const [what, n] of Object.entries(doomed[0])) {
  console.log(`  ${what.padEnd(10)} ${n}`)
}

if (!confirmed) {
  console.log(
    '\nThis was a dry run and nothing was changed.\n' +
      'Re-run with --confirm to actually delete, and take a backup first.',
  )
  await pool.end()
  process.exit(0)
}

// One transaction: a half-finished cleanup would leave matches pointing
// at players that no longer exist, which is worse than either outcome.
const client = await pool.connect()
try {
  await client.query('BEGIN')
  // Order matters. match_events and session_players cascade, but
  // matches.first_server_player is a plain reference with no ON DELETE,
  // so every match must be gone before any player can be.
  await client.query('DELETE FROM matches')
  await client.query('DELETE FROM sessions')
  await client.query('DELETE FROM players WHERE id <> $1', [player.id])
  await client.query('DELETE FROM invites')
  await client.query('DELETE FROM umpires WHERE id <> $1', [umpire.id])
  // The survivor must still be able to issue invites afterwards, and
  // the flag is granted automatically only to the founding umpire --
  // which this account may no longer be once the others are gone.
  await client.query('UPDATE umpires SET is_admin = true WHERE id = $1', [umpire.id])
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  console.error('\nRolled back, nothing was deleted:', error.message)
  process.exit(1)
} finally {
  client.release()
}

const { rows: after } = await pool.query(
  `SELECT (SELECT count(*)::int FROM umpires)      AS umpires,
          (SELECT count(*)::int FROM players)      AS players,
          (SELECT count(*)::int FROM sessions)     AS sessions,
          (SELECT count(*)::int FROM matches)      AS matches,
          (SELECT count(*)::int FROM match_events) AS events,
          (SELECT count(*)::int FROM invites)      AS invites`,
)
console.log('\nRemaining:', JSON.stringify(after[0]))
await pool.end()
