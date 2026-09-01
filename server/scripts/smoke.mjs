#!/usr/bin/env node
// ============================================================
// End-to-end smoke test for the phase-2 API.
//
//   node server/scripts/smoke.mjs [apiUrl]
//
// Needs SMOKE_EMAIL and SMOKE_PASSWORD for an existing umpire, or
// SMOKE_INVITE to register a new one.
//
// The six assertions that matter are the sync design's correctness
// argument, and they are why this file is kept rather than thrown away:
//
//   1. pushing the same log twice changes nothing        (retry safety)
//   2. pushing a SHORTER log removes the extra events    (undo)
//   3. status/winner are DERIVED, not believed           (trust)
//   4. ending early survives a re-sync                   (ended_early)
//   5. one code / one match cannot be double-claimed     (concurrency)
//   6. a game to 15 is not declared won at 11            (point_target)
// ============================================================

const API = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

let pass = 0
let fail = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  ok   ${label}`)
  } else {
    fail += 1
    failures.push(label)
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

let token = null

// Player rows this run creates that no umpire owns -- see the note at
// the point they are registered.
const selfRegistered = []

async function call(path, { method = 'GET', body, raw = false } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (raw) return { status: response.status, text: await response.text() }
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: response.status, body: json }
}

const uuid = () => crypto.randomUUID()
const DEVICE = `smoke-${uuid().slice(0, 8)}`

/** A rally event won by `playerId`, at sequence `seq`. */
const rally = (seq, playerId, outcome = 'winner', zone = 'open') => ({
  id: uuid(),
  seq,
  type: 'rally',
  at: Date.now(),
  actingPlayerId: playerId,
  outcome,
  zone,
})

async function main() {
  console.log(`smoke test against ${API}\n`)

  section('sign in')
  if (process.env.SMOKE_INVITE) {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: {
        email: `smoke.${Date.now()}@example.com`,
        name: 'Smoke Test',
        password: 'a-good-password',
        invite: process.env.SMOKE_INVITE,
      },
    })
    check('register with invite -> 201', reg.status === 201, JSON.stringify(reg.body))
    token = reg.body.token
  } else {
    const login = await call('/auth/login', {
      method: 'POST',
      body: { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD },
    })
    check('login -> 200', login.status === 200, JSON.stringify(login.body))
    token = login.body.token
  }
  if (!token) {
    console.log('\ncannot continue without a token')
    process.exit(1)
  }

  section('players — the identity guard')
  const stamp = Date.now()
  const nameA = `Smoke Alpha ${stamp}`
  const created = await call('/players', { method: 'POST', body: { name: nameA } })
  check('create player -> 201', created.status === 201, JSON.stringify(created.body))
  check('never leaks claim_code in the response', !JSON.stringify(created.body).includes('claim_code'))
  const playerA = created.body.player?.id

  const dupe = await call('/players', { method: 'POST', body: { name: nameA.toUpperCase() } })
  check('DIFFERENT CASE of an existing name -> 409', dupe.status === 409, JSON.stringify(dupe.body))
  check('409 carries the existing player so the app can offer "same person?"',
    dupe.body.player?.id === playerA, JSON.stringify(dupe.body.player))
  check('409 carries match_count for the confirmation',
    typeof dupe.body.player?.match_count === 'number')

  const others = []
  for (const suffix of ['Bravo', 'Charlie', 'Delta']) {
    const r = await call('/players', { method: 'POST', body: { name: `Smoke ${suffix} ${stamp}` } })
    others.push(r.body.player.id)
  }
  const search = await call(`/players?q=${encodeURIComponent(nameA)}`)
  check('exact name search puts the match first', search.body.players?.[0]?.id === playerA)

  const claim = await call(`/players/${playerA}/claim-code`)
  check('claim code is mintable on demand', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(claim.body.claimCode ?? ''),
    claim.body.claimCode)

  section('sessions')
  const sessionId = uuid()
  const s1 = await call('/sessions', { method: 'POST', body: { id: sessionId, name: `Smoke Night ${stamp}` } })
  check('create session -> 201', s1.status === 201, JSON.stringify(s1.body))
  const s2 = await call('/sessions', { method: 'POST', body: { id: sessionId, name: 'Renamed' } })
  check('replaying the same session id is idempotent', s2.status === 201)
  check('replay does not rename', s2.body.session?.name === `Smoke Night ${stamp}`, s2.body.session?.name)

  const roster = [playerA, ...others]
  const put1 = await call(`/sessions/${sessionId}/players`, { method: 'PUT', body: { playerIds: roster } })
  check('set roster -> 200', put1.status === 200, JSON.stringify(put1.body))
  check('roster has 4 players', put1.body.playerIds?.length === 4)
  const put2 = await call(`/sessions/${sessionId}/players`, { method: 'PUT', body: { playerIds: roster.slice(0, 2) } })
  check('roster replace SHRINKS as well as grows', put2.body.playerIds?.length === 2)
  await call(`/sessions/${sessionId}/players`, { method: 'PUT', body: { playerIds: roster } })

  section('matches')
  const matchId = uuid()
  const teamA = [roster[0], roster[1]]
  const teamB = [roster[2], roster[3]]
  const created2 = await call('/matches', {
    method: 'POST',
    body: {
      id: matchId, sessionId, teamA, teamB,
      stacking: { A: true, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      startedAt: Date.now() - 20 * 60_000,
    },
  })
  check('create match -> 201', created2.status === 201, JSON.stringify(created2.body))
  check('stacking A/B maps to the right columns (not swapped)',
    created2.body.match?.stacking?.A === true && created2.body.match?.stacking?.B === false,
    JSON.stringify(created2.body.match?.stacking))

  const badSeq = await call(`/matches/${matchId}/log`, {
    method: 'PUT',
    body: { deviceId: DEVICE, events: [rally(0, teamA[0]), rally(5, teamA[0])] },
  })
  check('non-contiguous seq is rejected -> 400', badSeq.status === 400, JSON.stringify(badSeq.body))

  const stranger = await call(`/matches/${matchId}/log`, {
    method: 'PUT',
    body: { deviceId: DEVICE, events: [rally(0, uuid())] },
  })
  check('event for a player not in the match is rejected -> 400', stranger.status === 400)

  section('ASSERTION 1 — pushing the same log twice changes nothing')
  const sixEvents = Array.from({ length: 6 }, (_, i) => rally(i, teamA[0]))
  const push1 = await call(`/matches/${matchId}/log`, { method: 'PUT', body: { deviceId: DEVICE, events: sixEvents } })
  check('first push -> 200', push1.status === 200, JSON.stringify(push1.body).slice(0, 200))
  check('6 events stored', push1.body.match?.events?.length === 6, String(push1.body.match?.events?.length))
  check('score is 6-0 to the serving team', push1.body.match?.eventCount === 6)

  const push2 = await call(`/matches/${matchId}/log`, { method: 'PUT', body: { deviceId: DEVICE, events: sixEvents } })
  check('IDENTICAL re-push -> still exactly 6 events, no duplicates',
    push2.body.match?.events?.length === 6, String(push2.body.match?.events?.length))

  section('ASSERTION 2 — a shorter log truncates (this is how undo syncs)')
  const shorter = sixEvents.slice(0, 3)
  const push3 = await call(`/matches/${matchId}/log`, { method: 'PUT', body: { deviceId: DEVICE, events: shorter } })
  check('pushing 3 events after 6 leaves exactly 3',
    push3.body.match?.events?.length === 3, String(push3.body.match?.events?.length))
  check('match is still in progress', push3.body.match?.status === 'in_progress')

  section('ASSERTION 3 — status and winner are DERIVED, never believed')
  const winning = Array.from({ length: 11 }, (_, i) => rally(i, teamA[0]))
  const won = await call(`/matches/${matchId}/log`, {
    method: 'PUT',
    // Deliberately lie: claim team B won and it ended early.
    body: { deviceId: DEVICE, events: winning, endedEarly: true, winner: 'B', status: 'in_progress' },
  })
  check('11 straight points completes the match', won.body.match?.status === 'completed', won.body.match?.status)
  check('winner derived as A, NOT the B the client claimed',
    won.body.match?.winner === 'A', String(won.body.match?.winner))
  check('ended_at was set', Boolean(won.body.match?.endedAt))

  section('ASSERTION 4 — ending early survives a re-sync')
  const earlyMatchId = uuid()
  await call('/matches', {
    method: 'POST',
    body: {
      id: earlyMatchId, sessionId, teamA, teamB,
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      startedAt: Date.now() - 10 * 60_000,
    },
  })
  const threeEvents = Array.from({ length: 3 }, (_, i) => rally(i, teamA[0]))
  const early1 = await call(`/matches/${earlyMatchId}/log`, {
    method: 'PUT',
    body: { deviceId: DEVICE, events: threeEvents, endedEarly: true, endedEarlyAt: Date.now() },
  })
  check('ended early -> completed', early1.body.match?.status === 'completed', early1.body.match?.status)
  check('ended_early flag recorded', early1.body.match?.endedEarly === true)

  const early2 = await call(`/matches/${earlyMatchId}/log`, {
    method: 'PUT',
    body: { deviceId: DEVICE, events: threeEvents, endedEarly: true, endedEarlyAt: Date.now() },
  })
  check('RE-SYNC does not reopen it (the bug this column exists to stop)',
    early2.body.match?.status === 'completed', early2.body.match?.status)

  section('ASSERTION 5 — a second device cannot score the same match')
  const otherDevice = `smoke-other-${uuid().slice(0, 8)}`
  const liveMatchId = uuid()
  await call('/matches', {
    method: 'POST',
    body: {
      id: liveMatchId, sessionId, teamA, teamB,
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      startedAt: Date.now(),
    },
  })
  await call(`/matches/${liveMatchId}/log`, { method: 'PUT', body: { deviceId: DEVICE, events: [rally(0, teamA[0])] } })
  const intruder = await call(`/matches/${liveMatchId}/log`, {
    method: 'PUT',
    body: { deviceId: otherDevice, events: [rally(0, teamB[0])] },
  })
  check('second device pushing to a held match -> 409', intruder.status === 409, JSON.stringify(intruder.body))
  check('409 says who holds it', Boolean(intruder.body.heldBy))

  const takeover = await call(`/matches/${liveMatchId}/claim`, {
    method: 'POST',
    body: { deviceId: otherDevice, force: true },
  })
  check('explicit takeover succeeds -> 200', takeover.status === 200, JSON.stringify(takeover.body).slice(0, 150))
  const afterTakeover = await call(`/matches/${liveMatchId}/log`, {
    method: 'PUT',
    body: { deviceId: otherDevice, events: [rally(0, teamB[0]), rally(1, teamB[0])] },
  })
  check('the taking-over device can now push', afterTakeover.status === 200)

  section('ASSERTION 6 — the point target is stored and honoured')
  // The whole risk of a per-match target is that it might be ignored on
  // the way in and re-derived against 11 on the way out, which would
  // declare a game to 15 finished at 11-9. These push exactly that.
  const longMatchId = uuid()
  const long1 = await call('/matches', {
    method: 'POST',
    body: {
      id: longMatchId, sessionId, teamA, teamB,
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      pointTarget: 15,
      startedAt: Date.now() - 30 * 60_000,
    },
  })
  check('create match with pointTarget 15 -> 201', long1.status === 201, JSON.stringify(long1.body))
  check('the target comes back on the match', long1.body.match?.pointTarget === 15,
    String(long1.body.match?.pointTarget))

  const elevenStraight = Array.from({ length: 11 }, (_, i) => rally(i, teamA[0]))
  const at11 = await call(`/matches/${longMatchId}/log`, {
    method: 'PUT', body: { deviceId: DEVICE, events: elevenStraight },
  })
  check('11 straight points does NOT finish a game to 15',
    at11.body.match?.status === 'in_progress', at11.body.match?.status)

  const fifteenStraight = Array.from({ length: 15 }, (_, i) => rally(i, teamA[0]))
  const at15 = await call(`/matches/${longMatchId}/log`, {
    method: 'PUT', body: { deviceId: DEVICE, events: fifteenStraight },
  })
  check('15 straight points finishes it', at15.body.match?.status === 'completed', at15.body.match?.status)
  check('winner still derived as A', at15.body.match?.winner === 'A', String(at15.body.match?.winner))

  const badTarget = await call('/matches', {
    method: 'POST',
    body: {
      id: uuid(), sessionId, teamA, teamB,
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      pointTarget: 13,
      startedAt: Date.now(),
    },
  })
  check('an unsupported target is refused -> 400', badTarget.status === 400, JSON.stringify(badTarget.body))

  // An older app build sends no target at all, and only ever played to
  // 11 -- so that has to stay the reading, not a null.
  const defaultTargetId = uuid()
  const noTarget = await call('/matches', {
    method: 'POST',
    body: {
      id: defaultTargetId, sessionId, teamA, teamB,
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      startedAt: Date.now(),
    },
  })
  check('a match sent without a target defaults to 11',
    noTarget.body.match?.pointTarget === 11, String(noTarget.body.match?.pointTarget))

  section('export — every umpire\'s matches, not just one device\'s')
  const json = await call('/export/match-logs.json')
  check('export json -> 200', json.status === 200)
  const mine = (json.body.rows ?? []).filter((r) => r.match_id === matchId)
  check('4 rows for the doubles match (one per player)', mine.length === 4, String(mine.length))
  const winnerRow = mine.find((r) => r.player_id === teamA[0])
  check('winning player has won=1', winnerRow?.won === 1, String(winnerRow?.won))
  check('winning player has 11 clean winners', winnerRow?.clean_winners === 11, String(winnerRow?.clean_winners))
  check('uses_stacking=1 for team A', winnerRow?.uses_stacking === 1, String(winnerRow?.uses_stacking))
  check('partner is the other team-A player', winnerRow?.partner_id === teamA[1])
  check('match_number assigned', typeof winnerRow?.match_number === 'number' && winnerRow.match_number >= 1)
  const loserRow = mine.find((r) => r.player_id === teamB[0])
  check('losing player has won=0 (not blank)', loserRow?.won === 0, String(loserRow?.won))

  const longRows = (json.body.rows ?? []).filter((r) => r.match_id === longMatchId)
  check('the 15-point match exports point_target=15',
    longRows.length > 0 && longRows.every((r) => r.point_target === 15),
    JSON.stringify(longRows.map((r) => r.point_target)))
  check('an 11-point match still exports point_target=11', winnerRow?.point_target === 11,
    String(winnerRow?.point_target))

  const csv = await call('/export/match-logs.csv', { raw: true })
  check('export csv -> 200', csv.status === 200)
  const lines = csv.text.trim().split('\n')
  // Asserted as the exact header rather than a column COUNT: the first
  // twelve are the columns aggregate_player_profiles() reads positionally
  // in the ML pipeline, so a reordering is as damaging as a missing
  // column and a count would not notice it.
  const expectedHeader = [
    'player_id', 'match_id', 'match_number',
    'drop_attempts', 'drop_successes', 'drive_attempts',
    'dink_errors', 'clean_winners', 'dink_winners', 'unforced_errors',
    'match_duration_mins', 'uses_stacking',
    'team', 'won', 'partner_id', 'opponent_1_id', 'opponent_2_id',
    'ended_at', 'point_target',
  ].join(',')
  check('csv header is exactly the expected columns, in order',
    lines[0] === expectedHeader, lines[0])
  const headerCols = lines[0].split(',').length
  check('every csv row has the same column count',
    lines.slice(1).every((l) => l.split(',').length === headerCols))

  // ============================================================
  section('internal — the ML pipeline seam')
  // ============================================================

  const INTERNAL_KEY = process.env.SMOKE_INTERNAL_KEY
  if (!INTERNAL_KEY) {
    check('SMOKE_INTERNAL_KEY is set so the internal routes can be tested', false,
      'set it to the API\'s INTERNAL_API_KEY')
  } else {
    async function internal(path, { method = 'GET', body, key = INTERNAL_KEY } = {}) {
      const response = await fetch(API + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(key ? { 'x-internal-key': key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      let json
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      return { status: response.status, body: json }
    }

    const noKey = await internal('/internal/match-logs.json', { key: null })
    check('internal without a key -> 401', noKey.status === 401, String(noKey.status))

    const wrongKey = await internal('/internal/match-logs.json', { key: 'x'.repeat(64) })
    check('internal with a wrong key -> 401', wrongKey.status === 401, String(wrongKey.status))

    // The two credential systems must not overlap in EITHER direction:
    // an umpire token is the credential most likely to be lying around,
    // and it must not open the service door.
    const asUmpire = await call('/internal/match-logs.json')
    check('an umpire token is not accepted on internal -> 401',
      asUmpire.status === 401, String(asUmpire.status))

    const logs = await internal('/internal/match-logs.json')
    check('internal match-logs with the key -> 200', logs.status === 200)
    check('internal returns the same rows as the umpire export',
      logs.body.count === (json.body.rows ?? []).length,
      `${logs.body.count} vs ${(json.body.rows ?? []).length}`)
    // The gate rides along with the data so the Python side does not
    // keep its own copy of the thresholds to drift out of step with.
    check('internal carries the rating gate thresholds',
      typeof logs.body.gate?.minMatchesPerPlayer === 'number' &&
      typeof logs.body.gate?.minPlayers === 'number', JSON.stringify(logs.body.gate))

    // A failed run is recorded rather than dropped: "the gate held" and
    // "the service never woke up" must not look identical afterwards.
    const failedRun = await internal('/internal/ratings', {
      method: 'POST',
      body: { status: 'failed', notes: { reason: 'smoke test' } },
    })
    check('a failed run is recorded -> 201', failedRun.status === 201, String(failedRun.status))

    const bogus = await internal('/internal/ratings', {
      method: 'POST',
      body: { ratings: [{ playerId: uuid(), skillScore: 50 }] },
    })
    check('ratings for an unknown player are refused -> 400', bogus.status === 400,
      JSON.stringify(bogus.body).slice(0, 80))

    const good = await internal('/internal/ratings', {
      method: 'POST',
      body: {
        pipelineVersion: 'smoke',
        playerCount: 1,
        matchCount: 9,
        ratings: [{
          playerId: playerA,
          skillScore: 72.4,
          skillTier: 'Intermediate',
          skillGroup: 'Higher-Performance',
          playstyleCluster: 1,
          playstyleArchetype: 'Patient Net Controller',
          evidence: { aggression_mean: 0.61 },
          matchCount: 9,
        }],
      },
    })
    check('a completed run is written -> 201', good.status === 201, String(good.status))

    // The whole point of storing snapshots: the number is meaningless
    // without the pool and the moment it was computed against.
    check('the run records the pool it was computed against',
      good.body.run?.id && good.body.run?.computed_at, JSON.stringify(good.body.run))

    const dupe = await internal('/internal/ratings', {
      method: 'POST',
      body: { ratings: [
        { playerId: playerA, skillScore: 1 },
        { playerId: playerA, skillScore: 2 },
      ] },
    })
    check('a duplicate player in one snapshot is refused -> 400', dupe.status === 400,
      String(dupe.status))

    // And the player-facing end of the seam: the score reaches the
    // player app, with the two facts that make it interpretable.
    const claimed = await fetch(`${API}/auth/player/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: claim.body.claimCode }),
    })
    const claimBody = await claimed.json()
    if (claimBody.token) {
      const me = await fetch(`${API}/player/me`, {
        headers: { Authorization: `Bearer ${claimBody.token}` },
      }).then((r) => r.json())
      check('the player sees their rating', me.rating?.state === 'rated',
        JSON.stringify(me.rating).slice(0, 90))
      check('the rating is rounded, not false precision', me.rating?.skillScore === 72,
        String(me.rating?.skillScore))
      check('the rating carries the pool it was measured against',
        me.rating?.poolSize === 1 && !!me.rating?.computedAt,
        JSON.stringify(me.rating))
      // Absolute cutoffs on a relative score would label the top player
      // in a pool of twelve "Professional". Stored, never shown.
      check('the tier is not sent to the player', me.rating?.skillTier === undefined,
        String(me.rating?.skillTier))

      check('one run gives one history point', me.rating?.history?.length === 1,
        JSON.stringify(me.rating?.history))

      // A SECOND run at the same score must not add a point. The
      // pipeline is deterministic -- random_state is fixed and the score
      // is not from K-Means -- so unchanged data reproduces the previous
      // score exactly, and a nightly schedule would otherwise pile up
      // identical points and bury the real changes among them.
      await internal('/internal/ratings', {
        method: 'POST',
        body: { playerCount: 1, ratings: [{ playerId: playerA, skillScore: 72.4 }] },
      })
      const same = await fetch(`${API}/player/me`, {
        headers: { Authorization: `Bearer ${claimBody.token}` },
      }).then((r) => r.json())
      check('an unchanged score does not add a history point',
        same.rating?.history?.length === 1, JSON.stringify(same.rating?.history))

      // A CHANGED score must. Sent with a larger pool, which is the
      // thing that makes a drop explicable rather than mysterious.
      await internal('/internal/ratings', {
        method: 'POST',
        body: { playerCount: 9, ratings: [{ playerId: playerA, skillScore: 64.2 }] },
      })
      const moved = await fetch(`${API}/player/me`, {
        headers: { Authorization: `Bearer ${claimBody.token}` },
      }).then((r) => r.json())
      const history = moved.rating?.history ?? []
      check('a changed score adds a history point', history.length === 2,
        JSON.stringify(history))
      check('history is oldest first', history[0]?.skillScore === 72,
        JSON.stringify(history.map((h) => h.skillScore)))
      check('each point carries the pool it was measured against',
        history[0]?.poolSize === 1 && history[1]?.poolSize === 9,
        JSON.stringify(history.map((h) => h.poolSize)))
      check('the headline score is the newest point',
        moved.rating?.skillScore === history[history.length - 1]?.skillScore,
        `${moved.rating?.skillScore} vs ${history[history.length - 1]?.skillScore}`)
    } else {
      check('claiming a player for the rating check succeeded', false,
        JSON.stringify(claimBody).slice(0, 80))
    }
  }

  section('player accounts — sign up alongside the claim code')
  {
    // A player token, not the umpire one `call` carries.
    async function asPlayer(path, { method = 'GET', body, bearer } = {}) {
      const response = await fetch(API + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      let json
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      return { status: response.status, body: json }
    }
    const register = (body) =>
      asPlayer('/auth/player/register', { method: 'POST', body })

    const u = `smoke_${stamp}`.slice(0, 20)
    const PASSWORD = 'not-a-real-password'

    // --- someone nobody has ever scored a match for ---
    const fresh = await register({
      name: `Smoke Newcomer ${stamp}`,
      username: u,
      password: PASSWORD,
    })
    check('register a brand-new name -> 201', fresh.status === 201,
      JSON.stringify(fresh.body).slice(0, 120))
    // Self-registered, so created_by is NULL and cleanup-test-data.mjs
    // cannot find it by ownership like it finds everything else here.
    // Reported at the end so a run against a shared database can be
    // cleaned up completely.
    if (fresh.body.player?.id) selfRegistered.push(fresh.body.player.id)
    check('register returns a working player token',
      (await asPlayer('/player/me', { bearer: fresh.body.token })).status === 200)
    check('register never echoes a password hash',
      !JSON.stringify(fresh.body).includes('password'), JSON.stringify(fresh.body).slice(0, 120))

    const takenUser = await register({
      name: `Smoke Someone Else ${stamp}`,
      username: u.toUpperCase(),
      password: PASSWORD,
    })
    check('a username differing only in CASE is refused -> 409',
      takenUser.status === 409, JSON.stringify(takenUser.body))
    check('409 says which field to fix', takenUser.body.usernameTaken === true)

    for (const [label, username] of [
      ['with spaces', 'two words'],
      ['too short', 'ab'],
      ['with a dot', 'ben.cruz'],
    ]) {
      const bad = await register({
        name: `Smoke Bad ${label} ${stamp}`,
        username,
        password: PASSWORD,
      })
      check(`a username ${label} is refused -> 400`, bad.status === 400, String(bad.status))
      check(`the refusal states the rule, not just "invalid" (${label})`,
        /letters, numbers and underscores/.test(bad.body.error ?? ''), bad.body.error)
    }

    const shortPw = await register({
      name: `Smoke Short ${stamp}`,
      username: `smk_short_${stamp}`.slice(0, 20),
      password: 'short',
    })
    check('too short a password is refused -> 400', shortPw.status === 400, String(shortPw.status))

    // --- THE CASE THIS DESIGN EXISTS FOR ---
    // nameA is on the roster with real matches and a rating behind it.
    // Registering under that name must not simply hand it over, and
    // must not be a dead end either.
    const noCode = await register({
      name: nameA,
      username: `smk_a_${stamp}`.slice(0, 20),
      password: PASSWORD,
    })
    check('registering as an EXISTING roster name is refused -> 409',
      noCode.status === 409, JSON.stringify(noCode.body).slice(0, 120))
    check('the refusal asks for the code rather than dead-ending',
      noCode.body.needsCode === true, JSON.stringify(noCode.body))

    const wrongCode = await register({
      name: nameA,
      username: `smk_a_${stamp}`.slice(0, 20),
      password: PASSWORD,
      code: 'PAD2-PAD2-PAD2',
    })
    check('the WRONG code is refused, still offering the field',
      wrongCode.status === 409 && wrongCode.body.needsCode === true,
      JSON.stringify(wrongCode.body).slice(0, 120))

    const linked = await register({
      name: nameA,
      username: `smk_a_${stamp}`.slice(0, 20),
      password: PASSWORD,
      code: claim.body.claimCode,
    })
    check('the RIGHT code links the account to the existing player -> 201',
      linked.status === 201, JSON.stringify(linked.body).slice(0, 120))
    check('it links rather than creating a duplicate',
      linked.body.player?.id === playerA,
      `${linked.body.player?.id} vs ${playerA}`)

    const linkedMe = await asPlayer('/player/me', { bearer: linked.body.token })
    check('the history an umpire recorded comes with it',
      (linkedMe.body.summary?.matches ?? 0) > 0,
      JSON.stringify(linkedMe.body.summary ?? null))
    check('and so does the rating', linkedMe.body.rating?.state === 'rated',
      JSON.stringify(linkedMe.body.rating ?? null).slice(0, 80))
    check('/player/me reports the username so the app can stop prompting',
      linkedMe.body.player?.username === `smk_a_${stamp}`.slice(0, 20),
      String(linkedMe.body.player?.username))

    const takenTwice = await register({
      name: nameA,
      username: `smk_a2_${stamp}`.slice(0, 20),
      password: PASSWORD,
      code: claim.body.claimCode,
    })
    check('a name that ALREADY has an account is refused outright -> 409',
      takenTwice.status === 409, String(takenTwice.status))
    check('and no longer offers the code field — the code cannot take over an account',
      takenTwice.body.needsCode === undefined, JSON.stringify(takenTwice.body))

    // --- signing back in ---
    const login = (body) => asPlayer('/auth/player/login', { method: 'POST', body })

    const goodLogin = await login({ username: `smk_a_${stamp}`.slice(0, 20), password: PASSWORD })
    check('sign in with username and password -> 200', goodLogin.status === 200,
      JSON.stringify(goodLogin.body).slice(0, 120))
    check('signing in returns the same player', goodLogin.body.player?.id === playerA)
    check('CASE-INSENSITIVE username on the way in',
      (await login({ username: `SMK_A_${stamp}`.slice(0, 20).toUpperCase(), password: PASSWORD }))
        .status === 200)

    const wrongPw = await login({ username: `smk_a_${stamp}`.slice(0, 20), password: 'wrong-password' })
    const unknown = await login({ username: `nobody_${stamp}`.slice(0, 20), password: PASSWORD })
    check('a wrong password -> 401', wrongPw.status === 401, String(wrongPw.status))
    check('an unknown username -> 401', unknown.status === 401, String(unknown.status))
    check('both give the SAME message, so neither reveals which usernames exist',
      wrongPw.body.error === unknown.body.error,
      `${wrongPw.body.error} vs ${unknown.body.error}`)

    // Most player rows have username NULL and no password hash. An
    // empty or missing username must miss them all rather than matching
    // one, which is the shape of bug that lets anyone in as anyone.
    check('an empty username signs nobody in',
      (await login({ password: PASSWORD })).status === 401)

    // --- the boundary between the two roles ---
    const asUmpireRoute = await asPlayer('/players', { bearer: linked.body.token })
    check('a player token still cannot reach an umpire route -> 403',
      asUmpireRoute.status === 403, String(asUmpireRoute.status))

    // --- the claim code as the recovery path ---
    // Deliberately still valid after a password is set: with no email
    // there is no reset link, so an umpire regenerating the code is how
    // a locked-out player gets back in.
    const recovered = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: claim.body.claimCode },
    })
    check('the claim code still works AFTER a password is set (the recovery path)',
      recovered.status === 200 && recovered.body.player?.id === playerA,
      JSON.stringify(recovered.body).slice(0, 100))
    check('and it reports the username, so no prompt to set up what exists',
      recovered.body.player?.username === `smk_a_${stamp}`.slice(0, 20),
      String(recovered.body.player?.username))

    // --- upgrading a code-only session into an account ---
    const echo = await call('/players', {
      method: 'POST',
      body: { name: `Smoke Echo ${stamp}` },
    })
    const echoCode = await call(`/players/${echo.body.player.id}/claim-code`)
    const echoSession = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: echoCode.body.claimCode },
    })
    check('a code-only player starts with no username',
      echoSession.body.player?.username === null,
      String(echoSession.body.player?.username))

    const setUp = await asPlayer('/auth/player/credentials', {
      method: 'POST',
      bearer: echoSession.body.token,
      body: { username: `smk_e_${stamp}`.slice(0, 20), password: PASSWORD },
    })
    check('setting up sign-in from inside the app -> 200', setUp.status === 200,
      JSON.stringify(setUp.body))
    check('and it works immediately',
      (await login({ username: `smk_e_${stamp}`.slice(0, 20), password: PASSWORD })).status === 200)

    // A phone left unlocked on the profile screen must not be a silent
    // account takeover.
    const noCurrent = await asPlayer('/auth/player/credentials', {
      method: 'POST',
      bearer: echoSession.body.token,
      body: { username: `smk_e_${stamp}`.slice(0, 20), password: 'a-different-password' },
    })
    check('changing an EXISTING password without the current one -> 403',
      noCurrent.status === 403, String(noCurrent.status))
    check('the old password still works after that refusal',
      (await login({ username: `smk_e_${stamp}`.slice(0, 20), password: PASSWORD })).status === 200)

    const withCurrent = await asPlayer('/auth/player/credentials', {
      method: 'POST',
      bearer: echoSession.body.token,
      body: {
        username: `smk_e_${stamp}`.slice(0, 20),
        password: 'a-different-password',
        currentPassword: PASSWORD,
      },
    })
    check('with the current password it goes through -> 200', withCurrent.status === 200,
      String(withCurrent.status))

    const stealUsername = await asPlayer('/auth/player/credentials', {
      method: 'POST',
      bearer: echoSession.body.token,
      body: {
        username: `smk_a_${stamp}`.slice(0, 20),
        password: 'a-different-password',
        currentPassword: 'a-different-password',
      },
    })
    check('and someone else\'s username cannot be taken -> 409',
      stealUsername.status === 409, String(stealUsername.status))

    // --- the roster stays free of credentials ---
    const roster2 = await call(`/players?q=${encodeURIComponent(nameA)}`)
    const rosterText = JSON.stringify(roster2.body)
    check('the roster never carries a username or a hash',
      !rosterText.includes('username') && !rosterText.includes('password') &&
      !rosterText.includes('claim_code'), rosterText.slice(0, 120))
  }

  if (selfRegistered.length > 0) {
    console.log(
      `\nself-registered players left behind (no umpire owns them):\n` +
        `  node scripts/cleanup-test-data.mjs 'smoke.%@example.com' ${selfRegistered.join(',')}`,
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nfailed:')
    failures.forEach((f) => console.log(`  - ${f}`))
  }
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error('\nsmoke test crashed:', error)
  process.exit(1)
})
