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

  section('claiming, sending and removing per side')
  {
    process.env.DATABASE_URL = urlFor('pp_migration_check')
    const { pool } = await import('../src/db.js')
    const { findVideo, videoBySide, clearStarsIfBare } = await import('../src/video-send.js')
    open.push({ end: () => pool.end() })
    const [ana, maria] = [1, 3].map(uuid)
    const [m1, m2] = [21, 22].map(uuid)
    const [r1, r2] = [31, 32].map(uuid)
    await pool.query("DELETE FROM match_videos WHERE match_id = $1 AND side = 'A'", [m1])
    await pool.query("UPDATE match_videos SET device_id = 'phone-B' WHERE match_id = $1", [m1])
    check('one side-B video: it is the first', (await findVideo(m1))?.side, 'B')
    check('a phone finds its own row', (await findVideo(m1, { deviceId: 'phone-B' }))?.side, 'B')
    check('another phone finds nothing', await findVideo(m1, { deviceId: 'phone-A' }), null)
    await pool.query("INSERT INTO match_videos (match_id, source, side, device_id, state) VALUES ($1, 'player', 'A', 'phone-A', 'ready')", [m1])
    check('with a side-A row too, side A is first', (await findVideo(m1))?.side, 'A')
    check('the phone still finds its own row', (await findVideo(m1, { deviceId: 'phone-B' }))?.side, 'B')
    check('videoBySide B', (await videoBySide(m1, 'B'))?.side, 'B')
    check('videoBySide A', (await videoBySide(m1, 'A'))?.device_id, 'phone-A')
    check('videoBySide facility', (await videoBySide(m2, 'facility'))?.source, 'facility')
    check('videoBySide facility on a match without one', await videoBySide(m1, 'facility'), null)
    check('videoBySide with nothing is the first row', (await videoBySide(m1, undefined))?.side, 'A')
    check('videoBySide with junk is the first row', (await videoBySide(m1, 'C'))?.side, 'A')
    check('the facility video is first of all', (await findVideo(m2))?.source, 'facility')

    // The beat's newest-match query (routes/player-video.js), copied (plus m.id = $2, since the other made-up matches are open too): a player is "being filmed" only on their own side.
    const newest = async (player) => (await pool.query(
      `SELECT m.id FROM matches m
         JOIN sessions s ON s.id = m.session_id
         LEFT JOIN match_videos v ON v.match_id = m.id
          AND (v.side IS NULL OR v.side = CASE WHEN m.team_a @> ARRAY[$1]::uuid[] THEN 'A' ELSE 'B' END)
        WHERE (m.team_a @> ARRAY[$1]::uuid[] OR m.team_b @> ARRAY[$1]::uuid[])
          AND m.status = 'in_progress' AND m.voided_at IS NULL AND s.voided_at IS NULL
          AND m.started_at > now() - interval '3 hours' AND m.id = $2
          AND (v.state = 'filming' OR GREATEST(m.started_at, m.scoring_claimed_at) > now() - interval '15 minutes')
        ORDER BY m.started_at DESC LIMIT 1`, [player, m1])).rows[0]?.id ?? null
    await pool.query("UPDATE matches SET status = 'in_progress', started_at = now() - interval '1 hour', scoring_claimed_at = NULL WHERE id = $1", [m1])
    await pool.query("UPDATE match_videos SET state = 'filming' WHERE match_id = $1 AND side = 'B'", [m1])
    check('side B is filming: side B sees the match', await newest(maria), m1)
    check('side B is filming: side A does not', await newest(ana), null)

    // Stars go with the last video, and only then.
    await pool.query('UPDATE matches SET highlights = $2::uuid[] WHERE id = $1', [m1, [r1, r2]])
    const stars = async () => (await pool.query('SELECT highlights FROM matches WHERE id = $1', [m1])).rows[0].highlights
    await pool.query("DELETE FROM match_videos WHERE match_id = $1 AND side = 'B'", [m1])
    await clearStarsIfBare(m1)
    check('another video remains: the stars stay', await stars(), [r1, r2])
    await pool.query('DELETE FROM match_videos WHERE match_id = $1', [m1])
    await clearStarsIfBare(m1)
    check('the last video is gone: the stars go', await stars(), [])
  }

  section('every reader gets the video to show first, and the other side\'s')
  {
    Object.assign(process.env, {
      VIDEO_BUCKET: 'test-bucket', VIDEO_BUCKET_ENDPOINT: 'https://s3.example.com', VIDEO_BUCKET_REGION: 'us-east-1',
      VIDEO_BUCKET_KEY_ID: 'AKIAEXAMPLE', VIDEO_BUCKET_SECRET: 'secret-example',
    })
    const { pool } = await import('../src/db.js')
    const { bucketConfig } = await import('../src/bucket.js')
    const { pointVideos } = await import('../src/point-video.js')
    const [ana, maria] = [1, 3].map(uuid)
    const [m1, m2] = [21, 22].map(uuid)
    const [r1, r2] = [31, 32].map(uuid)
    await pool.query('UPDATE matches SET highlights = $2::uuid[] WHERE id = $1', [m1, [r1, r2]])
    await pool.query(
      `INSERT INTO match_videos (match_id, source, player_id, side, device_id, state, file_key, duration_ms, width, height, first_frame_at, repacked)
       VALUES ($1, 'player', $2, 'A', 'phone-A', 'ready', 'videos/a.mp4', 600000, 1920, 1080, (SELECT min(at) - interval '5 seconds' FROM match_events WHERE match_id = $1), true),
              ($1, 'player', $3, 'B', 'phone-B', 'ready', 'videos/b.mp4', 600000, 1920, 1080, (SELECT min(at) - interval '5 seconds' FROM match_events WHERE match_id = $1), true)`,
      [m1, ana, maria])
    const load = async (id) => {
      const row = (await pool.query('SELECT * FROM matches WHERE id = $1', [id])).rows[0]
      const events = (await pool.query('SELECT id, type, payload, at FROM match_events WHERE match_id = $1 ORDER BY seq', [id])).rows
      return [row, events, events.map((e) => ({ type: e.type, ...e.payload }))]
    }
    const [row1, events1, log1] = await load(m1)
    const fileName = 'PaddlePad 2026-11-20 Cruz-Reyes vs Santos-Bautista'
    const forAna = await pointVideos(row1, events1, log1, { playerId: ana, fileName })
    const forMaria = await pointVideos(row1, events1, log1, { playerId: maria, fileName })
    const bare = await pointVideos(row1, events1, log1, { prefer: null })
    check('a side-A player: A first, B other', [forAna.video.side, forAna.otherVideo.side], ['A', 'B'])
    check('a side-B player: B first, A other', [forMaria.video.side, forMaria.otherVideo.side], ['B', 'A'])
    check('prefer null: side A first', [bare.video.side, bare.otherVideo.side], ['A', 'B'])
    check('both carry the match\'s highlights', [forAna.video.highlights.length, forAna.otherVideo.highlights.length], [2, 2])
    check('may remove only the one filmed by this player', [forAna.video.mayRemove, forAna.otherVideo.mayRemove], [true, false])
    check('the other side\'s player: reverse', [forMaria.video.mayRemove, forMaria.otherVideo.mayRemove], [true, false])
    check('side names are surnames', [forAna.video.sideNames, forAna.otherVideo.sideNames], [['Cruz', 'Reyes'], ['Santos', 'Bautista']])
    check('each file name ends with its side', [forAna.video.fileName, forAna.otherVideo.fileName],
      [`${fileName} (Cruz-Reyes)`, `${fileName} (Santos-Bautista)`])
    check('each download is named too', [decodeURIComponent(forAna.video.downloadUrl).includes('(Cruz-Reyes).mp4'), decodeURIComponent(forAna.otherVideo.downloadUrl).includes('(Santos-Bautista).mp4')], [true, true])
    check('no file name asked: none given', 'fileName' in bare.video, false)

    // The umpire's answer: first row of any state, plus the other side's ready row.
    const { videoAnswer } = await import('../src/routes/video.js')
    const answer = await videoAnswer(row1, bucketConfig())
    check('umpire: video is side A, other is side B', [answer.video.side, answer.otherVideo.side], ['A', 'B'])
    check('umpire: other has the same shape', Object.keys(answer.otherVideo).sort(), Object.keys(answer.video).sort())
    await pool.query("UPDATE match_videos SET state = 'filming' WHERE match_id = $1 AND side = 'B'", [m1])
    const half = await videoAnswer(row1, bucketConfig())
    check('umpire: the other side is not ready, so no other', [half.video.side, half.otherVideo], ['A', null])
    const only = await pointVideos(row1, events1, log1, { playerId: maria })
    check('one ready video: no other, name unchanged', [only.video.side, only.otherVideo], ['A', null])
    check('one ready video: no suffix', only.video.fileName, undefined)
    const single = await pointVideos(row1, events1, log1, { playerId: ana, fileName })
    check('one ready video: file name unchanged', single.video.fileName, fileName)
    await pool.query("UPDATE match_videos SET state = 'ready' WHERE match_id = $1", [m1])

    await pool.query(
      `UPDATE match_videos SET file_key = 'videos/f.mp4', duration_ms = 600000, width = 1920, height = 1080, first_frame_at = now(), repacked = true
        WHERE match_id = $1`, [m2])
    const [row2, events2, log2] = await load(m2)
    const fac = await pointVideos(row2, events2, log2, { playerId: ana, fileName: 'PaddlePad 2026-11-20 Cruz vs Garcia' })
    check('facility: no other video', fac.otherVideo, null)
    check('facility: file name unchanged', fac.video.fileName, 'PaddlePad 2026-11-20 Cruz vs Garcia')
    check('facility: no side, may not remove', [fac.video.side, fac.video.mayRemove], [null, false])
    check('no video at all', await pointVideos({ ...row2, id: uuid(99) }, [], [], {}), { video: null, otherVideo: null })
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
