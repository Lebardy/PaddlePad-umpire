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
