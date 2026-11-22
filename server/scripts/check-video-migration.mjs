#!/usr/bin/env node
// ============================================================
// The two-filmers schema change, run on real Postgres.
//
//   MIGRATION_DB_URL=postgres://... node server/scripts/check-video-migration.mjs
//
// Needs a login that may create databases (MIGRATION_DB_URL). It builds
// the throwaway database pp_migration_check, applies the previous schema,
// fills it with a few made-up matches, applies server/schema.sql twice,
// and checks what became of the videos and highlights.
//
// With MIGRATION_COPY_FROM set it also copies the matches and videos of
// that database (SELECT only, counts printed, never names) into a second
// throwaway database, pp_migration_copy, and migrates the copy.
//
// MIGRATION_OLD_SCHEMA is the previous schema file; without it the file
// comes from `git show 675b41c:server/schema.sql` (run at the repo root).
// Without MIGRATION_DB_URL the check is skipped, so `pnpm test` is
// green on a laptop. The throwaway databases are dropped at the end.
// ============================================================

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'

if (!process.env.MIGRATION_DB_URL) {
  console.log('skipped: MIGRATION_DB_URL not set')
  process.exit(0)
}

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)

const SOURCE = process.env.MIGRATION_DB_URL
const NAMES = ['pp_migration_check', 'pp_migration_copy']
const urlFor = (db) => { const u = new URL(SOURCE); u.pathname = `/${db}`; return u.toString() }
const sourceDb = decodeURIComponent(new URL(SOURCE).pathname.slice(1))
if (sourceDb.startsWith('pp_migration_')) {
  console.error('refusing to start: MIGRATION_DB_URL names a throwaway database')
  process.exit(1)
}

const oldSchema = process.env.MIGRATION_OLD_SCHEMA
  ? readFileSync(process.env.MIGRATION_OLD_SCHEMA, 'utf8')
  : execSync('git show 675b41c:server/schema.sql', { encoding: 'utf8', maxBuffer: 1 << 26 })
const newSchema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

const admin = new pg.Client({ connectionString: SOURCE })
const open = []
async function fresh(db) {
  await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${db}`)
  const c = new pg.Client({ connectionString: urlFor(db) })
  await c.connect()
  open.push(c)
  return c
}
const failsWith = async (c, sql, params) => {
  try { await c.query(sql, params); return null } catch (e) { return e.code }
}
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

try {
  await admin.connect()

  section('made-up matches')
  {
    const c = await fresh('pp_migration_check')
    await c.query(oldSchema)
    const [ana, jose, maria, ramon, lito] = [1, 2, 3, 4, 5].map(uuid)
    for (const [id, name] of [[ana, 'Ana Cruz'], [jose, 'Jose Reyes'], [maria, 'Maria Santos'], [ramon, 'Ramon Bautista'], [lito, 'Lito Garcia']]) {
      await c.query('INSERT INTO players (id, name) VALUES ($1, $2)', [id, name])
    }
    const session = uuid(10)
    await c.query("INSERT INTO sessions (id, name) VALUES ($1, 'Saturday morning')", [session])
    const [m1, m2, m3] = [21, 22, 23].map(uuid)
    const insertMatch = (id, a, b) => c.query(
      "INSERT INTO matches (id, session_id, team_a, team_b, first_server_team, first_server_player) VALUES ($1, $2, $3, $4, 'A', $5)",
      [id, session, a, b, a[0]])
    await insertMatch(m1, [ana, jose], [maria, ramon])
    await insertMatch(m2, [ana], [lito])
    await insertMatch(m3, [jose], [maria])
    const [r1, r2] = [31, 32].map(uuid)
    for (const [i, id] of [r1, r2].entries()) {
      await c.query("INSERT INTO match_events (id, match_id, seq, type, payload) VALUES ($1, $2, $3, 'rally', '{}')", [id, m1, i + 1])
    }
    const insertVideo = (match, source, player, highlights) => c.query(
      "INSERT INTO match_videos (match_id, source, player_id, device_id, state, highlights) VALUES ($1, $2, $3, 'phone-1', 'ready', $4)",
      [match, source, player, highlights])
    await insertVideo(m1, 'player', ramon, [r1, r2])
    await insertVideo(m2, 'facility', null, [])
    await insertVideo(m3, 'player', null, [])

    await c.query(newSchema)
    await c.query(newSchema)

    const side = async (m) => (await c.query('SELECT side FROM match_videos WHERE match_id = $1', [m])).rows[0].side
    check('a side-B filmer: side B', await side(m1), 'B')
    check('the facility video: no side', await side(m2), null)
    check('a deleted filmer: side A', await side(m3), 'A')
    const hl = async (m) => (await c.query('SELECT highlights FROM matches WHERE id = $1', [m])).rows[0].highlights
    check('highlights moved to the match', await hl(m1), [r1, r2])
    check('no highlights stays empty', await hl(m2), [])
    check('the video lost its highlights column', (await c.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'match_videos' AND column_name = 'highlights'")).rowCount, 0)
    check('the key is the row id', (await c.query(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'match_videos'::regclass AND contype = 'p'")).rows[0].d,
    'PRIMARY KEY (id)')
    check('a second side-B video is refused', await failsWith(c, "INSERT INTO match_videos (match_id, source, side, device_id) VALUES ($1, 'player', 'B', 'phone-2')", [m1]), '23505')
    check('a side-A video beside it is allowed', await failsWith(c, "INSERT INTO match_videos (match_id, source, side, device_id) VALUES ($1, 'player', 'A', 'phone-2')", [m1]), null)
    check('a second facility video is refused', await failsWith(c, "INSERT INTO match_videos (match_id, source, side, device_id) VALUES ($1, 'facility', NULL, 'phone-2')", [m2]), '23505')
    check('a facility video with a side is refused', await failsWith(c, "INSERT INTO match_videos (match_id, source, side, device_id) VALUES ($1, 'facility', 'A', 'phone-2')", [m3]), '23514')
  }

  if (process.env.MIGRATION_COPY_FROM) {
    section('a copy of the source database')
    const src = new pg.Client({ connectionString: process.env.MIGRATION_COPY_FROM })
    await src.connect()
    open.push(src)
    await src.query('BEGIN READ ONLY')
    const rows = async (table) => (await src.query(`SELECT row_to_json(t) AS r FROM ${table} t`)).rows.map((x) => x.r)
    const matches = await rows('matches')
    const videos = await rows('match_videos')
    await src.query('ROLLBACK')

    const c = await fresh('pp_migration_copy')
    await c.query(oldSchema)
    await c.query('SET session_replication_role = replica')
    for (const [table, list] of [['matches', matches], ['match_videos', videos]]) {
      const cols = (await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position", [table]))
        .rows.map((x) => `"${x.column_name}"`).join(', ')
      for (const r of list) {
        await c.query(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM json_populate_record(null::${table}, $1)`, [JSON.stringify(r)])
      }
    }
    console.log(`  ${matches.length} matches, ${videos.length} videos copied`)
    await c.query(newSchema)
    await c.query(newSchema)

    const after = (await c.query('SELECT match_id, player_id, source, side FROM match_videos')).rows
    check('the video count is unchanged', after.length, videos.length)
    const teamB = new Map(matches.map((m) => [m.id, m.team_b]))
    const wrongPlayer = after.filter((v) => v.source === 'player' &&
      v.side !== (v.player_id && teamB.get(v.match_id)?.includes(v.player_id) ? 'B' : 'A')).length
    check('every player video is on its filmer\'s side (wrong ones)', wrongPlayer, 0)
    check('every facility video has no side (wrong ones)', after.filter((v) => v.source === 'facility' && v.side !== null).length, 0)
    const wanted = videos.filter((v) => v.highlights?.length > 0)
    const held = new Map((await c.query('SELECT id, highlights FROM matches')).rows.map((m) => [m.id, m.highlights]))
    check(`${wanted.length} matches with highlights keep them in order (wrong ones)`,
      wanted.filter((v) => JSON.stringify(held.get(v.match_id)) !== JSON.stringify(v.highlights)).length, 0)
    check('the copy lost the video highlights column', (await c.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'match_videos' AND column_name = 'highlights'")).rowCount, 0)
  }
} catch (e) {
  console.error(e)
  fail += 1
} finally {
  for (const c of open) await c.end().catch(() => {})
  for (const name of NAMES) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch((e) => console.error(`could not drop ${name}: ${e.message}`))
  await admin.end().catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
