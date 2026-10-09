#!/usr/bin/env node
// ============================================================
// End-to-end smoke test for the phase-2 API.
//
//   node server/scripts/smoke.mjs [apiUrl]
//
// Needs SMOKE_EMAIL and SMOKE_PASSWORD for an existing umpire, or
// SMOKE_INVITE to register a new one.
//
// The admin section runs only against staging or a local server. Its
// owner checks need SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD for
// staging's owner; each run adds one throwaway admin and switches it
// off at the end. Production is never given test admins.
//
// On staging (SMOKE_TIDY=on there) the last section removes everything
// the run made -- umpires, admins, places, players and nights -- so
// staging keeps only the data someone meant to put there.
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

import { RALLY_ENDINGS, rallyEndingColumn } from '../src/rally-endings.js'
import { NOT_LEFT_OPEN_MESSAGE, SESSION_REASON_MESSAGE } from '../src/overview-rules.js'

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

// Everything else this run makes, by id, so the last section can remove
// it again on staging. Noted as responses go past, like openSessions
// below, so a section added later is covered without being told.
const made = { umpireIds: new Set(), adminIds: new Set(), facilityIds: new Set(), playerIds: new Set(), inviteCodes: new Set() }
const MADE_BY = {
  '/auth/register': ['umpireIds', (json) => json?.umpire?.id],
  '/admin/admins': ['adminIds', (json) => json?.admin?.id],
  '/admin/facilities': ['facilityIds', (json) => json?.facility?.id],
  '/players': ['playerIds', (json) => json?.player?.id],
  '/auth/player/register': ['playerIds', (json) => json?.player?.id],
  '/admin/invites': ['inviteCodes', (json) => json?.invite?.code],
}

function noteMade(path, method, status, json) {
  // Any sign-in as the smoke owner, however it was completed.
  if (path.startsWith('/admin/auth/') && json?.admin?.email &&
      json.admin.email.toLowerCase() === (process.env.SMOKE_OWNER_EMAIL ?? '').toLowerCase()) {
    smokeOwnerId = json.admin.id
  }
  if (method !== 'POST' || status !== 201 || !MADE_BY[path]) return
  const [key, read] = MADE_BY[path]
  const value = read(json)
  if (value) made[key].add(value)
}

// The umpire this run signs in as. It exists for the smoke test alone,
// so the nights and players it makes go in the tidy too.
let smokeUmpireId = null
// The admin it signs in as; its own activity lines go, the account stays.
let smokeOwnerId = null

// Sessions this run has opened and not closed again. Every run used to
// leave its nights open behind it, and the admin Overview's "worth a
// look" list filled up with them -- 161 at the last count, all of them
// this file's doing. The tidy pass at the end of main() closes them.
//
// Watching the requests go past, rather than asking each section to
// remember, means a section added later is covered without being told.
const openSessions = new Map()

function noteSession(path, method, body, bearer, status, json) {
  if (method !== 'POST') return
  if (path === '/sessions' && status === 201 && json?.session?.id) {
    openSessions.set(json.session.id, { bearer: bearer ?? token, umpireId: json.session.created_by })
    return
  }
  const ending = /^\/sessions\/([^/]+)\/end$/.exec(path)
  if (ending && status === 200) {
    // `ended: false` is a reopen, which puts it back on the list.
    if (body?.ended === false) {
      openSessions.set(ending[1], { bearer: bearer ?? token, umpireId: json?.session?.created_by })
    } else {
      openSessions.delete(ending[1])
    }
    return
  }
  const adminClose = /^\/admin\/overview\/sessions\/([^/]+)\/close$/.exec(path)
  if (adminClose && status === 200) openSessions.delete(adminClose[1])
}

/**
 * End every session this run still has open, as the umpire who opened
 * it.
 *
 * Ending is not voiding and not deleting: it stamps `ended_at` and
 * nothing else, so every match played in the session still counts.
 * Returns the ones it could not close, which should always be none.
 */
async function closeOpenSessions(umpireId = null) {
  const left = []
  for (const [id, who] of [...openSessions]) {
    if (umpireId && who.umpireId !== umpireId) continue
    const ended = await request(`/sessions/${id}/end`, { method: 'POST', bearer: who.bearer, body: {} })
    // A 404 means it is already gone, which is just as tidy.
    if (ended.status === 200 || ended.status === 404) openSessions.delete(id)
    else left.push(`${id} -> ${ended.status}`)
  }
  return left
}

// Guards the tidy below from tidying its own requests.
let tidying = false

/**
 * Closing an umpire takes away the only credential that can end their
 * sessions -- only the umpire who opened a session may end it, and an
 * admin may only close one the Overview has already flagged as left
 * open, which a session opened seconds ago is not.
 *
 * So the moment before a throwaway umpire is closed is the last moment
 * their nights can be tidied, and this is that moment. Catching it here
 * rather than beside each cleanup means a section added later gets it
 * without being told, and only that umpire's sessions are touched, so
 * nothing another section is still using is ended underneath it.
 */
async function tidyBeforeUmpireCloses(path, method) {
  if (tidying || method !== 'POST') return
  const closing = /^\/admin\/umpires\/([^/]+)\/close$/.exec(path)
  if (!closing) return
  tidying = true
  try {
    await closeOpenSessions(closing[1])
  } finally {
    tidying = false
  }
}

// How many times to wait out a rate-limit window before giving up.
const RATE_LIMIT_RETRIES = 4

/**
 * One request, with the rate limiter waited out rather than worked
 * around.
 *
 * This suite makes far more sign-in and sign-up attempts in a minute
 * than any person would -- which is exactly the traffic those limits
 * exist to stop, so being throttled here is the limiter working. Backing
 * off and retrying is what lets this run against a DEPLOYED environment
 * without anyone being asked to set DANGEROUSLY_DISABLE_RATE_LIMITS on
 * a public host, which is a thing no staging or production service
 * should ever have done to it. (e2e.mjs still sets it against its
 * throwaway local database, purely for speed.)
 *
 * No assertion in this file expects a 429, so nothing is being masked.
 * If one is ever added, it must call fetch directly.
 */
async function request(path, { method = 'GET', body, bearer, raw = false } = {}) {
  await tidyBeforeUmpireCloses(path, method)

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(API + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      // The limiter sets Retry-After to the seconds left in the window.
      // One extra second so the retry lands after the reset, not on it.
      const wait = (Number(response.headers.get('retry-after')) || 60) + 1
      console.log(`  ...  rate limited on ${path}, waiting ${wait}s`)
      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
      continue
    }

    if (raw) return { status: response.status, text: await response.text() }
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text }
    }
    noteSession(path, method, body, bearer, response.status, json)
    noteMade(path, method, response.status, json)
    return { status: response.status, body: json }
  }
}

/** A request carrying the umpire token this run signed in with. */
function call(path, options = {}) {
  return request(path, { ...options, bearer: token })
}

/**
 * A request carrying a PLAYER token (or none), rather than the umpire
 * token `call` sends. Module-scoped because more than one section needs
 * it now.
 */
function asPlayer(path, options = {}) {
  return request(path, options)
}

const uuid = () => crypto.randomUUID()

/**
 * Lets the clock move into a later second. An admin token from the SAME
 * second as a session reset survives it: sessionEnded (admin-rules.js)
 * compares whole seconds, so that the token handed back with the reset
 * still works. A check that an OLDER token has ended is therefore only
 * fair once the reset is sure to land in a later second than that token.
 */
const intoALaterSecond = () => new Promise((resolve) => setTimeout(resolve, 1100))
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

/**
 * Any one facility to assign a throwaway admin to, for sections that
 * predate facilities and only need *some* real facility to satisfy
 * `POST /admin/admins`' now-required `facilityId` -- not testing
 * facilities themselves, which the dedicated section below does. There
 * is always at least one once the switch-over has run.
 */
async function anyFacilityId(ownerBearer) {
  const listed = await request('/admin/facilities', { bearer: ownerBearer })
  return listed.body.facilities?.[0]?.id ?? null
}

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
    smokeUmpireId = login.body.umpire?.id ?? null
  }
  if (!token) {
    console.log('\ncannot continue without a token')
    process.exit(1)
  }

  // ============================================================
  section('google sign-in — the refusals')
  // ============================================================
  // The success path needs a real Google account and cannot run here.
  // What CAN be pinned is every way in that must be refused, which is
  // where the security of this actually lives: a token this server
  // accepts without checking who it was minted for would sign anyone in
  // as anyone.
  {
    const g = (body) => asPlayer('/auth/google', { method: 'POST', body })

    // The endpoint refuses everything with 503 until GOOGLE_CLIENT_ID is
    // set, because an unset audience would mean no audience check at
    // all. That is correct behaviour, not a failure -- so on a server
    // where Google is not configured these assertions are skipped
    // rather than reported as broken.
    const probe = await g({ credential: 'anything' })
    if (probe.status === 503) {
      console.log('  ...  Google sign-in not configured here; refusal checks skipped')
    } else {

    check('no credential -> 400', (await g({})).status === 400)
    check('a credential that is not a token at all -> 401',
      (await g({ credential: 'not-a-jwt' })).status === 401)
    check('a syntactically valid JWT with no kid -> 401',
      (await g({
        credential: [
          Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
          Buffer.from(JSON.stringify({ sub: '1', email: 'x@example.com' })).toString('base64url'),
          'not-a-real-signature',
        ].join('.'),
      })).status === 401)
    // The shape an attacker would actually try: everything Google sends,
    // an unrecognised signing key, and a signature that is simply wrong.
    check('a forged token naming an unknown key -> 401',
      (await g({
        credential: [
          Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'made-up', typ: 'JWT' })).toString('base64url'),
          Buffer.from(JSON.stringify({
            iss: 'https://accounts.google.com',
            sub: '999', email: 'attacker@example.com', email_verified: true,
            exp: Math.floor(Date.now() / 1000) + 3600,
          })).toString('base64url'),
          'forged',
        ].join('.'),
      })).status === 401)
    check('none of that created an umpire',
      (await asPlayer('/auth/login', {
        method: 'POST', body: { email: 'attacker@example.com', password: 'anything' },
      })).status === 401)

    // Linking needs BOTH halves: Google proves one account, the password
    // proves the other. A bad Google token must fail before the password
    // is even looked at, or this becomes a password oracle that does not
    // need a Google account at all.
    const link = (body) => asPlayer('/auth/google/link', { method: 'POST', body })
    check('linking with a junk Google token -> 401',
      (await link({ credential: 'junk', email: 'a@b.c', password: 'x' })).status === 401)
    check('linking with no credential at all -> 400',
      (await link({ email: 'a@b.c', password: 'x' })).status === 400)

    // The custom button sends an access token rather than the signed ID
    // token Google's own button produced. Both doors are open; both
    // must refuse a token that was not issued for this client.
    check('a made-up access token -> 401',
      (await g({ accessToken: 'ya29.not-a-real-token' })).status === 401)
    check('an empty access token -> 400',
      (await g({ accessToken: '' })).status === 400)

    // Connecting from INSIDE the app is a different endpoint, and it
    // has the same obligation: Google must be checked before anything
    // else, or a signed-in umpire could use it to test passwords.
    const connect = (body) =>
      call('/auth/google/connect', { method: 'POST', body })
    check('connecting with a junk Google token -> 401',
      (await connect({ credential: 'junk', currentPassword: 'wrong' })).status === 401)
    check('connecting with no credential at all -> 400',
      (await connect({ currentPassword: 'wrong' })).status === 400)
    }
  }

  // ============================================================
  section("the umpire's own account")
  // ============================================================
  // Nothing here changes the account it runs against. Every assertion
  // is a refusal, which is where this endpoint group's security lives:
  // an email quietly moved to an address someone else owns is a way in
  // through Google that never needed the password.
  {
    const me = await call('/auth/me')
    check('GET /auth/me -> 200', me.status === 200, JSON.stringify(me.body))
    check('it says whether a password is set',
      typeof me.body?.umpire?.hasPassword === 'boolean',
      JSON.stringify(me.body?.umpire))
    check('it never returns a password hash',
      me.body?.umpire && !('password_hash' in me.body.umpire),
      JSON.stringify(me.body?.umpire))
    check('googleEmail is present as a field, connected or not',
      me.body?.umpire && 'googleEmail' in me.body.umpire)

    const hasPassword = me.body?.umpire?.hasPassword === true
    const connected = Boolean(me.body?.umpire?.googleEmail)

    check('PATCH /auth/me with no token -> 401',
      (await asPlayer('/auth/me', { method: 'PATCH', body: { name: 'nope' } })).status === 401)

    if (hasPassword) {
      const moved = await call('/auth/me', {
        method: 'PATCH',
        body: { email: `hijack.${Date.now()}@example.com` },
      })
      check('changing the email without the password -> 403',
        moved.status === 403, JSON.stringify(moved.body))
      check('...and says which field is missing',
        moved.body?.needsCurrentPassword === true)

      const wrong = await call('/auth/me', {
        method: 'PATCH',
        body: {
          email: `hijack.${Date.now()}@example.com`,
          currentPassword: 'definitely-not-the-password',
        },
      })
      check('changing the email with a WRONG password -> 403', wrong.status === 403)

      check('changing the password without the current one -> 403',
        (await call('/auth/me/password', {
          method: 'POST', body: { password: 'a-long-enough-one' },
        })).status === 403)
    }

    check('a too-short new password -> 400',
      (await call('/auth/me/password', {
        method: 'POST', body: { password: 'short', currentPassword: 'x' },
      })).status === 400,
      'length must be checked before the current password, or this is a password oracle')

    // Renaming needs no password -- a display name is not a way in --
    // so this one really does write, and writes the same value back.
    const rename = await call('/auth/me', {
      method: 'PATCH', body: { name: me.body?.umpire?.name },
    })
    check('renaming to the same name -> 200', rename.status === 200,
      JSON.stringify(rename.body))
    check('the account comes back unchanged',
      rename.body?.umpire?.email === me.body?.umpire?.email &&
      rename.body?.umpire?.name === me.body?.umpire?.name)
    check('and a fresh token with it', typeof rename.body?.token === 'string')

    const off = await call('/auth/google/disconnect', { method: 'POST' })
    if (connected) {
      check('disconnecting Google without the password -> 403', off.status === 403,
        JSON.stringify(off.body))
    } else {
      check('disconnecting when nothing is connected -> 409', off.status === 409,
        JSON.stringify(off.body))
    }
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

  // Ending is not voiding: the night is over, but every match in it
  // still counts. The two states have to stay independent.
  const listed = await call('/sessions')
  const before = (listed.body.sessions ?? []).find((x) => x.id === sessionId)
  check('a session lists who created it', typeof before?.created_by === 'string',
    String(before?.created_by))
  check('and carries its created_by_name for display',
    typeof before?.created_by_name === 'string', String(before?.created_by_name))
  check('a fresh session is not ended', before?.ended_at === null,
    String(before?.ended_at))

  const ended = await call(`/sessions/${sessionId}/end`, { method: 'POST', body: {} })
  check('end a session -> 200', ended.status === 200, JSON.stringify(ended.body).slice(0, 120))
  check('ended_at is stamped', Boolean(ended.body.session?.ended_at),
    String(ended.body.session?.ended_at))
  check('ending does NOT void it', ended.body.session?.voided_at === null,
    String(ended.body.session?.voided_at))

  const reopened = await call(`/sessions/${sessionId}/end`, {
    method: 'POST', body: { ended: false },
  })
  check('reopen a session -> 200', reopened.status === 200)
  check('and ended_at is cleared', reopened.body.session?.ended_at === null,
    String(reopened.body.session?.ended_at))

  check('ending a session that does not exist -> 404',
    (await call(`/sessions/${uuid()}/end`, { method: 'POST', body: {} })).status === 404)

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

  section('an id or date the server cannot read is refused, not a server error')
  // The umpire app retries any 5xx for ever and holds everything queued
  // behind it, so a request that can never succeed has to answer 4xx.
  const notAnId = await call('/matches/not-an-id')
  check('a match address that is not an id -> 400', notAnId.status === 400, String(notAnId.status))
  const noSessionId = await call('/sessions/undefined/end', { method: 'POST', body: { ended: true } })
  check('ending a session whose id is missing -> 400', noSessionId.status === 400, String(noSessionId.status))
  const badEndTime = await call(`/matches/${liveMatchId}/log`, {
    method: 'PUT',
    body: { deviceId: otherDevice, events: [rally(0, teamB[0])], endedEarly: true, endedEarlyAt: 'not a date' },
  })
  check('a log with an end time that is not a date -> 400', badEndTime.status === 400, String(badEndTime.status))
  const stillLive = await call(`/matches/${liveMatchId}`)
  check('and the refused log changed nothing',
    stillLive.body.match?.status === 'in_progress' && stillLive.body.match?.eventCount === 2,
    `${stillLive.body.match?.status}, ${stillLive.body.match?.eventCount} events`)

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

  section('export — the umpire-facing download is gone')
  // Removed, not hidden: it handed every facility's completed matches
  // to any signed-in umpire, which is the one thing facility scoping
  // exists to prevent. The rows still leave the server, through
  // /internal/match-logs.json below, behind the service key.
  check('GET /export/match-logs.csv is gone -> 404',
    (await call('/export/match-logs.csv')).status === 404)
  check('GET /export/match-logs.json is gone -> 404',
    (await call('/export/match-logs.json')).status === 404)

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
    check('the count matches the rows actually sent',
      logs.body.count === (logs.body.rows ?? []).length,
      `${logs.body.count} vs ${(logs.body.rows ?? []).length}`)

    // What one match looks like by the time the pipeline reads it.
    // These used to live on the umpire-facing export; the rows are the
    // same rows, so they moved here rather than being dropped.
    const mine = (logs.body.rows ?? []).filter((r) => r.match_id === matchId)
    check('4 rows for the doubles match (one per player)', mine.length === 4, String(mine.length))
    const winnerRow = mine.find((r) => r.player_id === teamA[0])
    check('winning player has won=1', winnerRow?.won === 1, String(winnerRow?.won))
    check('winning player has 11 clean winners', winnerRow?.clean_winners === 11, String(winnerRow?.clean_winners))
    check('uses_stacking=1 for team A', winnerRow?.uses_stacking === 1, String(winnerRow?.uses_stacking))
    check('partner is the other team-A player', winnerRow?.partner_id === teamA[1])
    check('match_number assigned', typeof winnerRow?.match_number === 'number' && winnerRow.match_number >= 1)
    const loserRow = mine.find((r) => r.player_id === teamB[0])
    check('losing player has won=0 (not blank)', loserRow?.won === 0, String(loserRow?.won))

    const longRows = (logs.body.rows ?? []).filter((r) => r.match_id === longMatchId)
    check('the 15-point match carries point_target=15',
      longRows.length > 0 && longRows.every((r) => r.point_target === 15),
      JSON.stringify(longRows.map((r) => r.point_target)))
    check('an 11-point match still carries point_target=11', winnerRow?.point_target === 11,
      String(winnerRow?.point_target))

    // Asserted as the exact column list rather than a COUNT: the first
    // twelve are the columns aggregate_player_profiles() reads
    // positionally in the ML pipeline, so one going missing is as
    // damaging as the shape changing, and a count would not notice.
    const expectedColumns = [
      'player_id', 'match_id', 'match_number',
      'drop_attempts', 'drop_successes', 'drive_attempts',
      'dink_errors', 'clean_winners', 'dink_winners', 'unforced_errors',
      'match_duration_mins', 'uses_stacking',
      'team', 'won', 'partner_id', 'opponent_1_id', 'opponent_2_id',
      'ended_at', 'point_target',
      // How each rally ended, one count per ending, after everything the
      // pipeline already reads (see rally-endings.js).
      ...RALLY_ENDINGS.map((ending) => rallyEndingColumn(ending.key)),
    ]
    const missingColumns = expectedColumns.filter((col) => !(col in (winnerRow ?? {})))
    check('every column the pipeline reads is on the row',
      missingColumns.length === 0, missingColumns.join(', '))
    // The gate rides along with the data so the Python side does not
    // keep its own copy of the thresholds to drift out of step with.
    check('internal carries the rating gate thresholds',
      typeof logs.body.gate?.minMatchesPerPlayer === 'number' &&
      typeof logs.body.gate?.minPlayers === 'number', JSON.stringify(logs.body.gate))
    // Rally points name the pipeline's skill groups, so every player in
    // the rows must have some.
    const rowPlayers = new Set((logs.body.rows ?? []).map((row) => row.player_id))
    const pointed = logs.body.rallyPoints ?? {}
    check('internal carries rally points for every player in the rows',
      [...rowPlayers].every((id) => typeof pointed[id] === 'number'),
      `${[...rowPlayers].filter((id) => typeof pointed[id] !== 'number').length} of ${rowPlayers.size} missing`)

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
    check('/player/me carries the rally rating',
      ['rated', 'not_enough_matches'].includes(linkedMe.body.rallyRating?.state),
      JSON.stringify(linkedMe.body.rallyRating ?? null).slice(0, 120))
    check('/player/me says whether the leaderboard is open',
      typeof linkedMe.body?.leaderboardOpen === 'boolean', String(linkedMe.body?.leaderboardOpen))
    const board = await asPlayer('/player/leaderboard', { bearer: linked.body.token })
    check('/player/leaderboard -> 200', board.status === 200, String(board.status))
    const lb = board.body?.leaderboard
    check('a closed leaderboard sends nothing but that it is closed',
      lb?.open === true || JSON.stringify(lb) === '{"open":false}', JSON.stringify(lb).slice(0, 80))
    check('an open leaderboard sends no player ids',
      lb?.open !== true || lb.ranking.every((row) => !('id' in row)), JSON.stringify(lb?.ranking?.[0] ?? null))
    check('the open flag agrees with the leaderboard', lb?.open === linkedMe.body?.leaderboardOpen,
      `${lb?.open} vs ${linkedMe.body?.leaderboardOpen}`)
    check('and never another player\'s points',
      !JSON.stringify(linkedMe.body.rallyRating ?? {}).includes('byEnding'),
      'rallyRating is the shaped response, not the raw rating')
    const standingWithRally = await asPlayer('/player/standing', { bearer: linked.body.token })
    check('/player/standing carries the rally rating too',
      ['rated', 'not_enough_matches'].includes(standingWithRally.body.standing?.rallyRating?.state),
      JSON.stringify(standingWithRally.body.standing?.rallyRating ?? null).slice(0, 120))
    const listWithRally = await asPlayer('/player/matches', { bearer: linked.body.token })
    const listed = listWithRally.body.matches ?? []
    check('/player/matches carries a rally section with only the agreed fields',
      listed.length > 0 && listed.every((m) => m.rally === null || (
        JSON.stringify(Object.keys(m.rally).sort()) === JSON.stringify(['change', 'endings', 'expectation', 'result', 'untagged']) &&
        m.rally.endings.every((e) => JSON.stringify(Object.keys(e).sort()) === JSON.stringify(['ending', 'outcome', 'points', 'rallies'])))),
      JSON.stringify(listed[0]?.rally ?? null).slice(0, 160))
    check('the match list no longer carries the old score',
      listed.every((m) => !('ratedAs' in m) && !('expectation' in m)),
      JSON.stringify(Object.keys(listed[0] ?? {})))
    check('/player/me reports the username so the app can stop prompting',
      linkedMe.body.player?.username === `smk_a_${stamp}`.slice(0, 20),
      String(linkedMe.body.player?.username))

    // Ratings are kept in memory and reloaded only when a finished
    // match changes. These two moments are the ones that must reload.
    const ratedMatches = (me) => me.body.rallyRating?.matches ?? me.body.rallyRating?.have
    const ratedBefore = ratedMatches(linkedMe)
    const oneMoreId = uuid()
    await call('/matches', {
      method: 'POST',
      body: {
        id: oneMoreId, sessionId, teamA, teamB,
        stacking: { A: false, B: false },
        firstServer: { team: 'A', playerId: teamA[0] },
        startedAt: Date.now(),
      },
    })
    const elevenStraight = Array.from({ length: 11 }, (_, i) => rally(i, teamA[0]))
    await call(`/matches/${oneMoreId}/log`, { method: 'PUT', body: { deviceId: DEVICE, events: elevenStraight } })
    const meAfterWin = await asPlayer('/player/me', { bearer: linked.body.token })
    check('a finished match counts towards the rating at once',
      ratedMatches(meAfterWin) === ratedBefore + 1, `${ratedBefore} -> ${ratedMatches(meAfterWin)}`)
    await call(`/matches/${oneMoreId}/log`, { method: 'PUT', body: { deviceId: DEVICE, events: elevenStraight.slice(0, 5) } })
    const meAfterReopen = await asPlayer('/player/me', { bearer: linked.body.token })
    check('and stops counting as soon as it is reopened',
      ratedMatches(meAfterReopen) === ratedBefore, `${ratedBefore} -> ${ratedMatches(meAfterReopen)}`)
    await call(`/matches/${oneMoreId}`, { method: 'DELETE' })

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
    // A code stops working once its player has their own way in, so one
    // that was read out or sent around earlier is not a spare key to
    // the account. With no email there is no reset link: an umpire
    // making a NEW code is how a locked-out player gets back in.
    const spentCode = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: claim.body.claimCode },
    })
    check('the code used to set up the account no longer signs in -> 404',
      spentCode.status === 404, String(spentCode.status))
    const recoveryCode = await call(`/players/${playerA}/claim-code`)
    check('an umpire asking for that player\'s code now gets a NEW one',
      recoveryCode.status === 200 && Boolean(recoveryCode.body.claimCode) &&
        recoveryCode.body.claimCode !== claim.body.claimCode,
      String(recoveryCode.status))
    const recovered = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: recoveryCode.body.claimCode },
    })
    check('and the new code signs them back in (the recovery path)',
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
    const echoCodeAfter = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: echoCode.body.claimCode },
    })
    check('and the code that opened the session no longer signs in -> 404',
      echoCodeAfter.status === 404, String(echoCodeAfter.status))

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

  // ============================================================
  section('player profile — editing it, and deleting it')
  // ============================================================
  {
    const stamp2 = Date.now()
    const PASSWORD = 'not-a-real-password'
    const login = (body) => asPlayer('/auth/player/login', { method: 'POST', body })
    const register = (body) =>
      asPlayer('/auth/player/register', { method: 'POST', body })

    // Someone with an account and no matches, for the edit cases.
    const editorName = `Smoke Editor ${stamp2}`
    const editorUser = `smk_ed_${stamp2}`.slice(0, 20)
    const editor = await register({
      name: editorName,
      username: editorUser,
      password: PASSWORD,
    })
    check('a player to edit -> 201', editor.status === 201,
      JSON.stringify(editor.body).slice(0, 120))
    if (editor.body.player?.id) selfRegistered.push(editor.body.player.id)
    const editorToken = editor.body.token

    const rename = (body, bearer = editorToken) =>
      asPlayer('/player/me', { method: 'PATCH', bearer, body })

    // --- renaming ---
    const newName = `Smoke Renamed ${stamp2}`
    const renamed = await rename({ name: newName })
    check('rename to a free name -> 200', renamed.status === 200,
      JSON.stringify(renamed.body).slice(0, 120))
    check('the response carries the new name', renamed.body.player?.name === newName,
      String(renamed.body.player?.name))
    check('and /player/me agrees',
      (await asPlayer('/player/me', { bearer: editorToken })).body.player?.name === newName)

    // The unique index is on lower(name), so a row renaming itself to a
    // different capitalisation collides with its OWN index entry unless
    // Postgres handles it -- and fixing your own capitalisation is the
    // single most likely real edit.
    const recased = await rename({ name: newName.toUpperCase() })
    check('renaming to a different CAPITALISATION of your own name -> 200',
      recased.status === 200, JSON.stringify(recased.body).slice(0, 120))
    await rename({ name: newName })

    const stealName = await rename({ name: nameA })
    check("renaming to someone else's name -> 409", stealName.status === 409,
      String(stealName.status))
    check('and it says which field is wrong', stealName.body.nameTaken === true,
      JSON.stringify(stealName.body))

    check('an empty name -> 400', (await rename({ name: '   ' })).status === 400)
    check('an 81-character name -> 400',
      (await rename({ name: 'x'.repeat(81) })).status === 400)
    check('the roster shows the umpire the new name',
      JSON.stringify((await call(`/players?q=${encodeURIComponent(newName)}`)).body)
        .includes(newName))

    // --- editing one credential at a time ---
    const creds = (body, bearer = editorToken) =>
      asPlayer('/auth/player/credentials', { method: 'POST', bearer, body })

    const nextUser = `smk_ed2_${stamp2}`.slice(0, 20)
    check('changing the username WITHOUT the current password -> 403',
      (await creds({ username: nextUser })).status === 403)
    check('and the old username still signs in',
      (await login({ username: editorUser, password: PASSWORD })).status === 200)

    const userOnly = await creds({ username: nextUser, currentPassword: PASSWORD })
    check('changing only the username -> 200', userOnly.status === 200,
      JSON.stringify(userOnly.body))
    check('the new username signs in',
      (await login({ username: nextUser, password: PASSWORD })).status === 200)
    check('the old one no longer does',
      (await login({ username: editorUser, password: PASSWORD })).status === 401)

    const NEW_PASSWORD = 'another-not-real-password'
    const pwOnly = await creds({ password: NEW_PASSWORD, currentPassword: PASSWORD })
    check('changing only the password -> 200', pwOnly.status === 200,
      JSON.stringify(pwOnly.body))
    check('the username is untouched by a password-only change',
      pwOnly.body.username === nextUser, String(pwOnly.body.username))
    check('the new password signs in',
      (await login({ username: nextUser, password: NEW_PASSWORD })).status === 200)
    check('the old password does not',
      (await login({ username: nextUser, password: PASSWORD })).status === 401)
    check('sending neither field -> 400',
      (await creds({ currentPassword: NEW_PASSWORD })).status === 400)

    // Half an account is not a state worth being able to reach.
    const halfName = `Smoke Half ${stamp2}`
    const half = await call('/players', { method: 'POST', body: { name: halfName } })
    const halfCode = await call(`/players/${half.body.player.id}/claim-code`)
    const halfSession = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: halfCode.body.claimCode },
    })
    check('a code-only player setting a username with no password -> 400',
      (await creds({ username: `smk_h_${stamp2}`.slice(0, 20) }, halfSession.body.token))
        .status === 400)

    // --- deleting a profile that has no matches ---
    const goneName = `Smoke Gone ${stamp2}`
    const gone = await register({
      name: goneName,
      username: `smk_gn_${stamp2}`.slice(0, 20),
      password: PASSWORD,
    })
    const goneToken = gone.body.token
    check('deleting without the password when one is set -> 403',
      (await asPlayer('/player/me', { method: 'DELETE', bearer: goneToken })).status === 403)

    const hardDelete = await asPlayer('/player/me', {
      method: 'DELETE',
      bearer: goneToken,
      body: { password: PASSWORD },
    })
    check('a player who never played is deleted outright -> 200',
      hardDelete.status === 200, JSON.stringify(hardDelete.body))
    check('and the response says so, rather than leaving the app to guess',
      hardDelete.body.deleted === true, JSON.stringify(hardDelete.body))
    check('the record is gone from the roster',
      !JSON.stringify((await call(`/players?q=${encodeURIComponent(goneName)}`)).body)
        .includes(goneName))
    check('and the token they still hold is dead',
      (await asPlayer('/player/me', { bearer: goneToken })).status === 401)

    // --- deleting a profile that HAS matches ---
    // playerA has real matches, a rating, and partners whose history
    // names them. This is the case the whole design turns on.
    const aUser = `smk_a_${stamp}`.slice(0, 20)
    const aSession = await login({ username: aUser, password: PASSWORD })
    check('the player with history signs in first -> 200', aSession.status === 200,
      String(aSession.status))
    const aToken = aSession.body.token

    const softDelete = await asPlayer('/player/me', {
      method: 'DELETE',
      bearer: aToken,
      body: { password: PASSWORD },
    })
    check('a player WITH matches -> 200', softDelete.status === 200,
      JSON.stringify(softDelete.body))
    check('but the record is NOT deleted', softDelete.body.deleted === false,
      JSON.stringify(softDelete.body))
    check('and it reports how many matches are staying',
      (softDelete.body.matches ?? 0) > 0, JSON.stringify(softDelete.body))

    check('the token is refused the moment the account is closed',
      (await asPlayer('/player/me', { bearer: aToken })).status === 401)
    check('/auth/player/me refuses it too, so credentials cannot be re-set',
      (await asPlayer('/auth/player/me', { bearer: aToken })).status === 401)
    check('the old username no longer signs in',
      (await login({ username: aUser, password: PASSWORD })).status === 401)

    // The point of keeping the row: other people's history still reads.
    const rosterAfter = await call(`/players?q=${encodeURIComponent(nameA)}`)
    check('the umpire roster still lists them',
      JSON.stringify(rosterAfter.body).includes(nameA),
      JSON.stringify(rosterAfter.body).slice(0, 120))
    check('and shows them as unclaimed again, so a new code can be minted',
      rosterAfter.body.players?.[0]?.claimed === false,
      JSON.stringify(rosterAfter.body.players?.[0] ?? null).slice(0, 120))
    check('their match count is untouched',
      (rosterAfter.body.players?.[0]?.match_count ?? 0) > 0,
      String(rosterAfter.body.players?.[0]?.match_count))

    // --- coming back, the same way a forgotten password comes back ---
    const freshCode = await call(`/players/${playerA}/claim-code`)
    check('the umpire can mint a fresh code for a closed account',
      freshCode.status === 200 && Boolean(freshCode.body.claimCode),
      JSON.stringify(freshCode.body).slice(0, 80))
    check('the wiped code is not the old one',
      freshCode.body.claimCode !== claim.body.claimCode)

    const revived = await asPlayer('/auth/player/claim', {
      method: 'POST',
      body: { code: freshCode.body.claimCode },
    })
    check('claiming it revives the account -> 200', revived.status === 200,
      JSON.stringify(revived.body).slice(0, 120))
    check('as the same player', revived.body.player?.id === playerA,
      `${revived.body.player?.id} vs ${playerA}`)
    const revivedMe = await asPlayer('/player/me', { bearer: revived.body.token })
    check('with every match still there', (revivedMe.body.summary?.matches ?? 0) > 0,
      JSON.stringify(revivedMe.body.summary ?? null))
    check('and no username, because deleting really did remove the sign-in',
      revivedMe.body.player?.username === null,
      String(revivedMe.body.player?.username))
  }

  // ============================================================
  section('linking a code to an account you already have')
  // ============================================================
  // The case none of the sections above covers: someone signs up FIRST,
  // and only later is handed a code for the record an umpire has been
  // keeping under a different spelling of their name. Two rows, one
  // human. These assert the merge moves everything -- including the tap
  // log, which is the half that fails silently if it is skipped.
  {
    const stamp3 = Date.now()
    const PASSWORD = 'not-a-real-password'
    const register = (body) =>
      asPlayer('/auth/player/register', { method: 'POST', body })

    const newPlayer = async (name) =>
      (await call('/players', { method: 'POST', body: { name } })).body.player.id

    async function newSession(name, playerIds) {
      const sid = uuid()
      await call('/sessions', { method: 'POST', body: { id: sid, name } })
      await call(`/sessions/${sid}/players`, { method: 'PUT', body: { playerIds } })
      return sid
    }

    // A finished game to 11 with a[0] winning every rally, so there are
    // real derived stats to move rather than empty rows -- which is what
    // makes the tap-log assertion below mean anything.
    async function playMatch(sid, a, b) {
      const id = uuid()
      await call('/matches', {
        method: 'POST',
        body: {
          id, sessionId: sid, teamA: a, teamB: b,
          stacking: { A: false, B: false },
          firstServer: { team: 'A', playerId: a[0] },
          startedAt: Date.now() - 40 * 60_000,
        },
      })
      const done = await call(`/matches/${id}/log`, {
        method: 'PUT',
        body: {
          deviceId: DEVICE,
          events: Array.from({ length: 11 }, (_, i) => rally(i, a[0])),
        },
      })
      return { id, status: done.body.match?.status }
    }

    // --- the umpire's record, under a spelling only they use ---
    const spellingName = `Smoke Ump Spelling ${stamp3}`
    const spelling = await newPlayer(spellingName)
    const mates = []
    for (const s of ['Mate1', 'Mate2', 'Mate3']) {
      mates.push(await newPlayer(`Smoke ${s} ${stamp3}`))
    }
    const sid1 = await newSession(`Smoke Link Night ${stamp3}`, [spelling, ...mates])
    const m1 = await playMatch(sid1, [spelling, mates[0]], [mates[1], mates[2]])
    check('the umpire has a finished match under their own spelling',
      m1.status === 'completed', String(m1.status))
    const spellingCode = (await call(`/players/${spelling}/claim-code`)).body.claimCode

    // --- the account, made before any umpire knew them ---
    const ownName = `Smoke Own Name ${stamp3}`
    const ownUser = `smk_own_${stamp3}`.slice(0, 20)
    const own = await register({ name: ownName, username: ownUser, password: PASSWORD })
    check('an account created before the umpire had anything -> 201',
      own.status === 201, JSON.stringify(own.body).slice(0, 120))
    const ownId = own.body.player?.id
    if (ownId) selfRegistered.push(ownId)
    const ownToken = own.body.token

    // Give the account history of its own, so the merge has to move
    // matches in both directions rather than just adopting a row.
    const sid2 = await newSession(`Smoke Own Night ${stamp3}`, [ownId, ...mates])
    const m2 = await playMatch(sid2, [ownId, mates[0]], [mates[1], mates[2]])
    check('and a match recorded against that account too',
      m2.status === 'completed', String(m2.status))

    const link = (body, bearer = ownToken) =>
      asPlayer('/player/link', { method: 'POST', bearer, body })

    // --- the refusals, each before anything is written ---
    check('linking a code that matches nobody -> 404',
      (await link({ code: 'PAD-0000-0000' })).status === 404)

    const ownCode = (await call(`/players/${ownId}/claim-code`)).body.claimCode
    const mine = await link({ code: ownCode })
    check('your own code is not an error, just nothing to do',
      mine.status === 200 && mine.body.alreadyYours === true,
      JSON.stringify(mine.body).slice(0, 120))

    // An umpire can make a code for a player who already has an
    // account, because that is the forgotten-password path -- so
    // holding one must NOT be enough to absorb a real account.
    const rivalUser = `smk_rival_${stamp3}`.slice(0, 20)
    const rival = await register({
      name: `Smoke Rival ${stamp3}`, username: rivalUser, password: PASSWORD,
    })
    if (rival.body.player?.id) selfRegistered.push(rival.body.player.id)
    const rivalCode = (await call(`/players/${rival.body.player?.id}/claim-code`)).body.claimCode
    check('a code belonging to a REGISTERED account is refused -> 409',
      (await link({ code: rivalCode })).status === 409)

    // mates[0] played alongside the account in m2, so the two ids are
    // demonstrably two people and no rewrite of that match is safe.
    const mateCode = (await call(`/players/${mates[0]}/claim-code`)).body.claimCode
    const sharedRefusal = await link({ code: mateCode })
    check('a code for someone you have shared a match with -> 409',
      sharedRefusal.status === 409, JSON.stringify(sharedRefusal.body).slice(0, 140))
    check('and it says how many matches gave it away',
      sharedRefusal.body.sharedMatches >= 1, String(sharedRefusal.body.sharedMatches))

    // --- the dry run ---
    const preview = await link({ code: spellingCode })
    check('a link without confirm previews rather than merges -> 200',
      preview.status === 200 && preview.body.preview === true,
      JSON.stringify(preview.body).slice(0, 140))
    check('the preview names the umpire\'s spelling',
      preview.body.name === spellingName, String(preview.body.name))
    check('and counts both sides', preview.body.theirs === 1 && preview.body.yours === 1,
      `${preview.body.theirs}/${preview.body.yours}`)
    check('totalling what one account would hold', preview.body.matches === 2,
      String(preview.body.matches))
    check('the preview WROTE NOTHING -- the name is untouched',
      (await asPlayer('/player/me', { bearer: ownToken })).body.player?.name === ownName)

    // --- the merge ---
    const merged = await link({ code: spellingCode, confirm: true })
    check('confirming the link -> 200', merged.status === 200,
      JSON.stringify(merged.body).slice(0, 140))
    check('every match ends up on one account', merged.body.matches === 2,
      String(merged.body.matches))
    check('the umpire\'s spelling is the one that survives',
      merged.body.player?.name === spellingName, String(merged.body.player?.name))
    check('the account came with it', merged.body.player?.username === ownUser,
      String(merged.body.player?.username))
    check('and the name being left behind is reported back',
      merged.body.previousName === ownName, String(merged.body.previousName))

    const mergedToken = merged.body.token
    check('the old token dies with the row it named -> 401',
      (await asPlayer('/player/me', { bearer: ownToken })).status === 401)

    const mergedMe = await asPlayer('/player/me', { bearer: mergedToken })
    check('the new token works -> 200', mergedMe.status === 200)
    const linkCodeAfter = await asPlayer('/auth/player/claim', { method: 'POST', body: { code: spellingCode } })
    check('and the code that linked them no longer signs in -> 404',
      linkCodeAfter.status === 404, String(linkCodeAfter.status))
    check('and shows both matches', mergedMe.body.summary?.matches === 2,
      JSON.stringify(mergedMe.body.summary ?? null))

    const rosterAfter = await call(`/players?q=${encodeURIComponent(`Smoke Own Name ${stamp3}`)}`)
    check('the roster no longer carries the duplicate',
      (rosterAfter.body.players ?? []).every((p) => p.name !== ownName),
      JSON.stringify((rosterAfter.body.players ?? []).map((p) => p.name)))
    const survivor = await call(`/players/${spelling}`)
    check('and the surviving entry now has both matches',
      survivor.body.player?.match_count === 2, String(survivor.body.player?.match_count))

    // --- the half that fails silently ---
    const history = await asPlayer('/player/matches', { bearer: mergedToken })
    const played = history.body.matches ?? []
    check('both matches are in the merged history', played.length === 2, String(played.length))
    // If the team arrays were rewritten but the event payloads were not,
    // every one of these would be zero while the match list still looked
    // perfectly correct. This is the assertion that catches it.
    check('the TAP LOG followed the merge -- stats survive on both matches',
      played.length === 2 && played.every((m) => (m.stats?.clean_winners ?? 0) === 11),
      JSON.stringify(played.map((m) => m.stats?.clean_winners ?? null)))
    // A botched array_replace leaves dangling ids that resolve to no name.
    check('every player on court still resolves to a name',
      played.every((m) => !m.opponents?.includes('Unknown') && m.partner !== 'Unknown'),
      JSON.stringify(played.map((m) => [m.partner, m.opponents])))

    const backIn = await asPlayer('/auth/player/login', {
      method: 'POST', body: { username: ownUser, password: PASSWORD },
    })
    check('the username they chose still signs them in -> 200', backIn.status === 200)
    check('and lands on the surviving record', backIn.body.player?.id === spelling,
      `${backIn.body.player?.id} vs ${spelling}`)
  }

  section('admin site — doors that need no owner')
  const ADMIN_SECTION = /staging|localhost|127\.0\.0\.1/.test(API)
  if (!ADMIN_SECTION) {
    console.log('  skip (admin checks run against staging or a local server only)')
  } else {
    const noToken = await request('/admin/invites')
    check('admin routes refuse a request with no token -> 401', noToken.status === 401, String(noToken.status))
    const asUmpire = await request('/admin/invites', { bearer: token })
    check('admin routes refuse an umpire token -> 403', asUmpire.status === 403, String(asUmpire.status))
    const wrong = await request('/admin/auth/login', {
      method: 'POST', body: { email: `nobody.${uuid().slice(0, 8)}@example.com`, password: 'not-a-real-password' },
    })
    check('an unknown admin email is refused -> 401', wrong.status === 401, String(wrong.status))
    const badLink = await request(`/admin/auth/setup/${'x'.repeat(43)}`)
    check('an unknown setup link is gone -> 410', badLink.status === 410, String(badLink.status))
    const badGoogle = await request('/admin/auth/google', { method: 'POST', body: { accessToken: 'not-a-google-token' } })
    check('a made-up Google token signs no one in', badGoogle.status === 401 || badGoogle.status === 503, String(badGoogle.status))
  }

  section('admin site — owner, admins, invite codes and the activity record')
  const OWNER_EMAIL = process.env.SMOKE_OWNER_EMAIL
  const OWNER_PASSWORD = process.env.SMOKE_OWNER_PASSWORD
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    const ownerIn = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('the owner signs in -> 200', ownerIn.status === 200, JSON.stringify(ownerIn.body).slice(0, 80))
    const owner = ownerIn.body.token
    check('as the owner', ownerIn.body.admin?.role === 'owner', ownerIn.body.admin?.role)
    check('the response never carries a password hash', !JSON.stringify(ownerIn.body).includes('password_hash'))

    const ownerOnUmpire = await request('/auth/me', { bearer: owner })
    check('an admin token is refused by the umpire app -> 403', ownerOnUmpire.status === 403, String(ownerOnUmpire.status))
    const ownerOnPlayer = await request('/player/me', { bearer: owner })
    check('an admin token is refused by the player app -> 403', ownerOnPlayer.status === 403, String(ownerOnPlayer.status))

    const facilityForAdmins = await anyFacilityId(owner)
    check('a facility exists to assign the throwaway admin to', Boolean(facilityForAdmins), String(facilityForAdmins))

    const email = `smoke.admin.${uuid().slice(0, 8)}@example.com`
    const added = await request('/admin/admins', {
      method: 'POST', bearer: owner, body: { name: 'Smoke Admin', email, facilityId: facilityForAdmins },
    })
    check('the owner adds an admin -> 201', added.status === 201, JSON.stringify(added.body).slice(0, 80))
    const adminId = added.body.admin?.id
    const firstLink = added.body.setupLink?.url ?? ''
    check('and gets a setup link to the admin site', firstLink.includes('/setup/'), firstLink)
    const hoursLeft = (new Date(added.body.setupLink?.expiresAt) - Date.now()) / 3_600_000
    check('the link lasts 24 hours', hoursLeft > 23.9 && hoursLeft < 24.1, String(hoursLeft))
    const dupe = await request('/admin/admins', {
      method: 'POST', bearer: owner, body: { name: 'Again', email, facilityId: facilityForAdmins },
    })
    check('the same email cannot be added twice -> 409', dupe.status === 409, String(dupe.status))

    // A second link cancels the first.
    const relinked = await request(`/admin/admins/${adminId}/setup-link`, { method: 'POST', bearer: owner })
    check('the owner makes a new link -> 200', relinked.status === 200, String(relinked.status))
    const secret = (url) => url.split('/setup/')[1]
    const oldLink = await request(`/admin/auth/setup/${secret(firstLink)}`)
    check('the older link stops working -> 410', oldLink.status === 410, String(oldLink.status))
    const link = secret(relinked.body.setupLink?.url ?? '')
    const opened = await request(`/admin/auth/setup/${link}`)
    check('the newer link opens -> 200, for the right person',
      opened.status === 200 && opened.body.admin?.email === email, JSON.stringify(opened.body).slice(0, 80))

    const short = await request(`/admin/auth/setup/${link}`, { method: 'POST', body: { password: 'short' } })
    check('a short password is refused -> 400', short.status === 400, String(short.status))
    const ADMIN_PASSWORD = `smoke-${uuid()}`
    const setUp = await request(`/admin/auth/setup/${link}`, { method: 'POST', body: { password: ADMIN_PASSWORD } })
    check('finishing setup signs the admin in -> 200', setUp.status === 200 && setUp.body.admin?.role === 'admin',
      JSON.stringify(setUp.body).slice(0, 80))
    const again = await request(`/admin/auth/setup/${link}`, { method: 'POST', body: { password: ADMIN_PASSWORD } })
    check('the link works only once -> 410', again.status === 410, String(again.status))

    const adminIn = await request('/admin/auth/login', { method: 'POST', body: { email, password: ADMIN_PASSWORD } })
    check('the new admin signs in with their password -> 200', adminIn.status === 200, String(adminIn.status))
    const admin = adminIn.body.token

    const notOwner = await request('/admin/admins', { bearer: admin })
    check('an admin cannot see the owner-only admins list -> 403', notOwner.status === 403, String(notOwner.status))
    const noGoogle = await request('/admin/auth/me/google/disconnect', { method: 'POST', bearer: admin })
    check('disconnecting Google that was never connected -> 409', noGoogle.status === 409, String(noGoogle.status))

    const made = await request('/admin/invites', { method: 'POST', bearer: admin, body: { note: 'smoke test', expiresInDays: 3 } })
    check('an admin makes an invite code -> 201', made.status === 201, JSON.stringify(made.body).slice(0, 80))
    const code = made.body.invite?.code
    const badExpiry = await request('/admin/invites', { method: 'POST', bearer: admin, body: { expiresInDays: 400 } })
    check('an expiry past a year is refused -> 400', badExpiry.status === 400, String(badExpiry.status))
    const listed = await request('/admin/invites', { bearer: admin })
    const row = listed.body.invites?.find((i) => i.code === code)
    check('the code is listed as open, made by that admin',
      row?.status === 'open' && row?.created_by_name === 'Smoke Admin' && row?.made_before_admin_site === false,
      JSON.stringify(row))
    const cancelled = await request(`/admin/invites/${code}`, { method: 'DELETE', bearer: admin })
    check('the admin cancels it -> 204', cancelled.status === 204, String(cancelled.status))
    const cancelledAgain = await request(`/admin/invites/${code}`, { method: 'DELETE', bearer: admin })
    check('cancelling it again -> 404', cancelledAgain.status === 404, String(cancelledAgain.status))

    const activity = await request(`/admin/activity?adminId=${adminId}`, { bearer: owner })
    const actions = (activity.body.entries ?? []).map((e) => e.action)
    const count = (name) => actions.filter((a) => a === name).length
    check('the record holds exactly one setup, one sign-in, one code made and one cancelled',
      count('admin.setup_completed') === 1 && count('admin.signed_in') === 1 &&
        count('invite.created') === 1 && count('invite.cancelled') === 1,
      JSON.stringify(actions))
    check('the failed cancel added nothing, and no whole code is recorded',
      !JSON.stringify(activity.body).includes(code), JSON.stringify(activity.body).slice(0, 120))
    const byOwner = await request(`/admin/activity?action=admin.added`, { bearer: owner })
    check('adding the admin was recorded once',
      (byOwner.body.entries ?? []).filter((e) => e.targetId === adminId).length === 1)

    const ownerOff = await request(`/admin/admins/${ownerIn.body.admin.id}/switch-off`, { method: 'POST', bearer: owner })
    check('the owner cannot be switched off -> 409', ownerOff.status === 409, String(ownerOff.status))
    const off = await request(`/admin/admins/${adminId}/switch-off`, { method: 'POST', bearer: owner })
    check('the owner switches the admin off -> 200', off.status === 200 && off.body.admin?.active === false, String(off.status))
    const afterOff = await request('/admin/invites', { bearer: admin })
    check('their still-valid token stops working at once -> 401', afterOff.status === 401, String(afterOff.status))
    const loginOff = await request('/admin/auth/login', { method: 'POST', body: { email, password: ADMIN_PASSWORD } })
    check('and the right password says access is switched off -> 403', loginOff.status === 403, String(loginOff.status))
    const on = await request(`/admin/admins/${adminId}/switch-on`, { method: 'POST', bearer: owner })
    check('switched back on -> 200', on.status === 200 && on.body.admin?.active === true, String(on.status))
    // Switching off ends every session that admin held (see Task 5's
    // "ending sessions" section); switching back on does not restore
    // them, so the token from before switch-off stays ended.
    const stillOldToken = await request('/admin/invites', { bearer: admin })
    check('the pre-switch-off token stays ended even after being switched back on -> 401',
      stillOldToken.status === 401, String(stillOldToken.status))
    const backIn = await request('/admin/auth/login', { method: 'POST', body: { email, password: ADMIN_PASSWORD } })
    check('signing in fresh works again -> 200', backIn.status === 200, String(backIn.status))
    const offAgain = await request(`/admin/admins/${adminId}/switch-off`, { method: 'POST', bearer: owner })
    check('the throwaway admin is left switched off', offAgain.status === 200, String(offAgain.status))
  }

  section('admin site — people: looking up, pausing and closing')
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    // Neither the JSON text nor a row's own keys may carry a password
    // hash or a claim code, whichever spelling -- the same thing "never
    // leaks claim_code in the response" above checks for the
    // create-player response. Not a bare "password": signInMethods
    // legitimately lists the WORD "password" as a sign-in method, and
    // that is not a leak.
    const clean = (value) => {
      const text = JSON.stringify(value)
      return !/password_hash/i.test(text) && !/claim_code|claimcode/i.test(text)
    }
    const countByAction = async (action, targetId, bearer) => {
      const activity = await request(`/admin/activity?action=${action}`, { bearer })
      return (activity.body.entries ?? []).filter((e) => e.targetId === targetId).length
    }
    const countAny = async (targetId, bearer) => {
      const activity = await request('/admin/activity', { bearer })
      return (activity.body.entries ?? []).filter((e) => e.targetId === targetId).length
    }

    const pStamp = Date.now()

    // --- 1: owner signs in, mints an invite, registers a throwaway umpire ---
    const ownerIn2 = await request('/admin/auth/login', {
      method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    })
    check('the owner signs in for the people section -> 200', ownerIn2.status === 200,
      JSON.stringify(ownerIn2.body).slice(0, 80))
    const ownerToken = ownerIn2.body.token

    // The owner belongs to no facility, so making a code needs one named
    // explicitly -- any real facility works, since this section is not
    // testing facilities themselves.
    const pInviteFacility = await anyFacilityId(ownerToken)
    const pInvite = await request('/admin/invites', {
      method: 'POST', bearer: ownerToken, body: { note: 'smoke people', facilityId: pInviteFacility },
    })
    check('an invite code is made for the throwaway umpire -> 201', pInvite.status === 201,
      JSON.stringify(pInvite.body).slice(0, 80))
    const inviteCode = pInvite.body.invite?.code

    const umpEmail = `smoke.people.${pStamp}@example.com`
    const umpName = `Smoke People Umpire ${pStamp}`
    const umpPassword = `smk-${uuid()}`
    const umpReg = await request('/auth/register', {
      method: 'POST', body: { email: umpEmail, name: umpName, password: umpPassword, invite: inviteCode },
    })
    check('the throwaway umpire registers -> 201', umpReg.status === 201,
      JSON.stringify(umpReg.body).slice(0, 80))
    let umpToken = umpReg.body.token
    const umpireId = umpReg.body.umpire?.id

    // --- 2: as that umpire, create, claim and register a throwaway player ---
    const plName = `Smoke People Player ${pStamp}`
    const plCreate = await request('/players', { method: 'POST', bearer: umpToken, body: { name: plName } })
    check('the umpire creates the throwaway player -> 201', plCreate.status === 201,
      JSON.stringify(plCreate.body).slice(0, 80))
    const playerId = plCreate.body.player?.id

    const plCode1 = await request(`/players/${playerId}/claim-code`, { bearer: umpToken })
    const plClaim = await request('/auth/player/claim', { method: 'POST', body: { code: plCode1.body.claimCode } })
    check('claiming the throwaway player -> 200', plClaim.status === 200,
      JSON.stringify(plClaim.body).slice(0, 80))

    const plUsername = `smk_ppl_${pStamp}`.slice(0, 20)
    const plPassword = `smk-${uuid()}`
    const plReg = await request('/auth/player/register', {
      method: 'POST',
      body: { name: plName, username: plUsername, password: plPassword, code: plCode1.body.claimCode },
    })
    check('registering a username and password for it -> 201', plReg.status === 201,
      JSON.stringify(plReg.body).slice(0, 80))
    check('it links to the same player', plReg.body.player?.id === playerId,
      `${plReg.body.player?.id} vs ${playerId}`)
    let playerToken = plReg.body.token

    // --- 3: lists ---
    const umpList = await request(`/admin/umpires?q=${pStamp}`, { bearer: ownerToken })
    const foundUmp = (umpList.body.umpires ?? []).filter((u) => u.id === umpireId)
    check('the umpire list finds exactly the throwaway umpire', foundUmp.length === 1, JSON.stringify(foundUmp))
    check('and it is active', foundUmp[0]?.status === 'active', foundUmp[0]?.status)

    const plList = await request(`/admin/players?q=${pStamp}`, { bearer: ownerToken })
    const foundPl = (plList.body.players ?? []).filter((p) => p.id === playerId)
    check('the player list finds the throwaway player', foundPl.length === 1, JSON.stringify(foundPl))
    check('claimed is true', foundPl[0]?.claimed === true, String(foundPl[0]?.claimed))
    check('its row has no claimCode/claim_code key', clean(foundPl[0] ?? {}), JSON.stringify(foundPl[0] ?? {}))

    const umpPaused0 = await request(`/admin/umpires?q=${pStamp}&status=paused`, { bearer: ownerToken })
    check('status=paused does not list the active umpire',
      (umpPaused0.body.umpires ?? []).every((u) => u.id !== umpireId))
    const plPaused0 = await request(`/admin/players?q=${pStamp}&status=paused`, { bearer: ownerToken })
    check('status=paused does not list the active player',
      (plPaused0.body.players ?? []).every((p) => p.id !== playerId))

    // --- 4: one person ---
    const plDetail0 = await request(`/admin/players/${playerId}`, { bearer: ownerToken })
    check('player detail -> 200', plDetail0.status === 200, JSON.stringify(plDetail0.body).slice(0, 80))
    check('matches is an array', Array.isArray(plDetail0.body.player?.matches))
    check('rating is an object',
      typeof plDetail0.body.player?.rating === 'object' && plDetail0.body.player?.rating !== null)
    check('no password or claim key on the player detail', clean(plDetail0.body.player),
      JSON.stringify(plDetail0.body.player).slice(0, 200))

    const umpDetail0 = await request(`/admin/umpires/${umpireId}`, { bearer: ownerToken })
    check('umpire detail -> 200', umpDetail0.status === 200, JSON.stringify(umpDetail0.body).slice(0, 80))
    check('invite.code matches the code used to register',
      umpDetail0.body.umpire?.invite?.code === inviteCode, `${umpDetail0.body.umpire?.invite?.code} vs ${inviteCode}`)

    // --- 5: pause the umpire ---
    const beforePauseUmp = await countAny(umpireId, ownerToken)
    const blankReason = await request(`/admin/umpires/${umpireId}/pause`, {
      method: 'POST', bearer: ownerToken, body: { reason: '   ' },
    })
    check('a blank pause reason -> 400', blankReason.status === 400, String(blankReason.status))
    const pauseUmp = await request(`/admin/umpires/${umpireId}/pause`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke test' },
    })
    check('pausing the umpire -> 200, status paused',
      pauseUmp.status === 200 && pauseUmp.body.umpire?.status === 'paused',
      JSON.stringify(pauseUmp.body).slice(0, 80))

    const meOldToken = await request('/auth/me', { bearer: umpToken })
    check('the umpire\'s old token -> 401, status paused',
      meOldToken.status === 401 && meOldToken.body.status === 'paused', JSON.stringify(meOldToken.body))
    const loginRightPw = await request('/auth/login', { method: 'POST', body: { email: umpEmail, password: umpPassword } })
    check('signing in with the right password while paused -> 403, status paused',
      loginRightPw.status === 403 && loginRightPw.body.status === 'paused', JSON.stringify(loginRightPw.body))
    const loginWrongPw = await request('/auth/login', { method: 'POST', body: { email: umpEmail, password: 'definitely-wrong' } })
    check('a wrong password while paused -> 401, revealing nothing', loginWrongPw.status === 401,
      String(loginWrongPw.status))

    const pauseAgain = await request(`/admin/umpires/${umpireId}/pause`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'again' },
    })
    check('pausing an already-paused umpire -> 409', pauseAgain.status === 409, String(pauseAgain.status))
    const afterPauseUmp = await countAny(umpireId, ownerToken)
    check('only the one successful pause added activity; the refusals added none',
      afterPauseUmp === beforePauseUmp + 1, `${beforePauseUmp} -> ${afterPauseUmp}`)

    // --- 6: unpause ---
    const unpauseUmp = await request(`/admin/umpires/${umpireId}/unpause`, { method: 'POST', bearer: ownerToken })
    check('unpausing the umpire -> 200, status active',
      unpauseUmp.status === 200 && unpauseUmp.body.umpire?.status === 'active',
      JSON.stringify(unpauseUmp.body).slice(0, 80))
    const loginAfterUnpause = await request('/auth/login', { method: 'POST', body: { email: umpEmail, password: umpPassword } })
    check('the umpire can sign in again -> 200', loginAfterUnpause.status === 200, String(loginAfterUnpause.status))
    umpToken = loginAfterUnpause.body.token
    const meNewToken = await request('/auth/me', { bearer: umpToken })
    check('the new token works on /auth/me', meNewToken.status === 200, String(meNewToken.status))
    const unpauseAgain = await request(`/admin/umpires/${umpireId}/unpause`, { method: 'POST', bearer: ownerToken })
    check('unpausing an already-active umpire -> 409', unpauseAgain.status === 409, String(unpauseAgain.status))

    // --- 7: pause the player ---
    const pausePl = await request(`/admin/players/${playerId}/pause`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke test' },
    })
    check('pausing the player -> 200, status paused',
      pausePl.status === 200 && pausePl.body.player?.status === 'paused', JSON.stringify(pausePl.body).slice(0, 80))

    const plMePaused = await request('/auth/player/me', { bearer: playerToken })
    check('the player\'s token -> 401, status paused',
      plMePaused.status === 401 && plMePaused.body.status === 'paused', JSON.stringify(plMePaused.body))
    const plLoginPaused = await request('/auth/player/login', { method: 'POST', body: { username: plUsername, password: plPassword } })
    check('signing in as the paused player -> 403', plLoginPaused.status === 403, String(plLoginPaused.status))
    const plCodeWhilePaused = await request(`/admin/players/${playerId}/claim-code`, { method: 'POST', bearer: ownerToken })
    check('a new claim code for a paused player -> 409', plCodeWhilePaused.status === 409, String(plCodeWhilePaused.status))

    const unpausePl = await request(`/admin/players/${playerId}/unpause`, { method: 'POST', bearer: ownerToken })
    check('unpausing the player -> 200, status active',
      unpausePl.status === 200 && unpausePl.body.player?.status === 'active', JSON.stringify(unpausePl.body).slice(0, 80))

    // --- 8: new claim code ---
    const newCode = await request(`/admin/players/${playerId}/claim-code`, { method: 'POST', bearer: ownerToken })
    check('a new claim code is minted -> 200', newCode.status === 200, JSON.stringify(newCode.body).slice(0, 80))
    check('it differs from the old one', newCode.body.claimCode !== plCode1.body.claimCode, newCode.body.claimCode)
    const claimOldCode = await request('/auth/player/claim', { method: 'POST', body: { code: plCode1.body.claimCode } })
    check('claiming the old code -> 404', claimOldCode.status === 404, String(claimOldCode.status))
    const claimNewCode = await request('/auth/player/claim', { method: 'POST', body: { code: newCode.body.claimCode } })
    check('claiming the new code -> 200, same player',
      claimNewCode.status === 200 && claimNewCode.body.player?.id === playerId,
      JSON.stringify(claimNewCode.body).slice(0, 80))
    playerToken = claimNewCode.body.token

    // --- 9: activity ---
    const umpirePausedCount = await countByAction('umpire.paused', umpireId, ownerToken)
    check('exactly one umpire.paused entry', umpirePausedCount === 1, String(umpirePausedCount))
    const umpireUnpausedCount = await countByAction('umpire.unpaused', umpireId, ownerToken)
    check('exactly one umpire.unpaused entry', umpireUnpausedCount === 1, String(umpireUnpausedCount))
    const playerPausedCount = await countByAction('player.paused', playerId, ownerToken)
    check('exactly one player.paused entry', playerPausedCount === 1, String(playerPausedCount))
    const playerUnpausedCount = await countByAction('player.unpaused', playerId, ownerToken)
    check('exactly one player.unpaused entry', playerUnpausedCount === 1, String(playerUnpausedCount))
    const claimCodeCreatedCount = await countByAction('player.claim_code_created', playerId, ownerToken)
    check('exactly one player.claim_code_created entry', claimCodeCreatedCount === 1, String(claimCodeCreatedCount))

    // --- 10: non-owner admin ---
    const peopleAdminFacility = await anyFacilityId(ownerToken)
    const peopleAdminEmail = `smoke.people.admin.${uuid().slice(0, 8)}@example.com`
    const addedAdmin = await request('/admin/admins', {
      method: 'POST', bearer: ownerToken,
      body: { name: 'Smoke People Admin', email: peopleAdminEmail, facilityId: peopleAdminFacility },
    })
    check('the owner adds a throwaway admin -> 201', addedAdmin.status === 201,
      JSON.stringify(addedAdmin.body).slice(0, 80))
    const peopleAdminId = addedAdmin.body.admin?.id
    const setupSecret = (addedAdmin.body.setupLink?.url ?? '').split('/setup/')[1]
    const peopleAdminPassword = `smk-${uuid()}`
    const setupDone = await request(`/admin/auth/setup/${setupSecret}`, {
      method: 'POST', body: { password: peopleAdminPassword },
    })
    check('the throwaway admin completes setup -> 200', setupDone.status === 200,
      JSON.stringify(setupDone.body).slice(0, 80))
    const peopleAdminIn = await request('/admin/auth/login', {
      method: 'POST', body: { email: peopleAdminEmail, password: peopleAdminPassword },
    })
    check('the throwaway admin signs in -> 200', peopleAdminIn.status === 200, String(peopleAdminIn.status))
    const peopleAdmin = peopleAdminIn.body.token

    const nonOwnerClose = await request(`/admin/players/${playerId}/close`, {
      method: 'POST', bearer: peopleAdmin, body: { confirmName: plName },
    })
    check('a non-owner admin cannot close a player -> 403, the owner-only message',
      nonOwnerClose.status === 403 && nonOwnerClose.body.error === 'Only the owner can close accounts',
      JSON.stringify(nonOwnerClose.body))

    const nonOwnerPause = await request(`/admin/umpires/${umpireId}/pause`, {
      method: 'POST', bearer: peopleAdmin, body: { reason: 'any admin can pause' },
    })
    check('any admin can pause an umpire -> 200, status paused',
      nonOwnerPause.status === 200 && nonOwnerPause.body.umpire?.status === 'paused',
      JSON.stringify(nonOwnerPause.body).slice(0, 80))
    const nonOwnerUnpause = await request(`/admin/umpires/${umpireId}/unpause`, { method: 'POST', bearer: peopleAdmin })
    check('and unpauses it again -> 200, status active',
      nonOwnerUnpause.status === 200 && nonOwnerUnpause.body.umpire?.status === 'active',
      JSON.stringify(nonOwnerUnpause.body).slice(0, 80))

    // Kept switched on a little longer: --- 12 below needs it to try
    // reopening the player the owner is about to close.

    // --- 11: close ---
    const wrongConfirm = await request(`/admin/players/${playerId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke test', confirmName: 'not the right name' },
    })
    check('closing with the wrong confirmName -> 400', wrongConfirm.status === 400, String(wrongConfirm.status))

    const plDetailBefore = await request(`/admin/players/${playerId}`, { bearer: ownerToken })
    const closePl = await request(`/admin/players/${playerId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke test', confirmName: plName },
    })
    check('closing the player with the right name -> 200, status closed',
      closePl.status === 200 && closePl.body.player?.status === 'closed', JSON.stringify(closePl.body).slice(0, 80))
    const plUsernameLogin = await request('/auth/player/login', { method: 'POST', body: { username: plUsername, password: plPassword } })
    check('the closed player\'s username login -> 401', plUsernameLogin.status === 401, String(plUsernameLogin.status))
    const plDetailAfter = await request(`/admin/players/${playerId}`, { bearer: ownerToken })
    check('the match count is unchanged after closing',
      plDetailAfter.body.player?.matchCount === plDetailBefore.body.player?.matchCount,
      `${plDetailBefore.body.player?.matchCount} -> ${plDetailAfter.body.player?.matchCount}`)

    // --- 12: only the owner may reopen a player the owner closed ---
    const umpClaimAfterClose = await request(`/players/${playerId}/claim-code`, { bearer: umpToken })
    check('the umpire route refuses a claim code for an owner-closed player -> 403',
      umpClaimAfterClose.status === 403 &&
        umpClaimAfterClose.body.error === "This player's account was closed by the owner. Only the owner can reopen it.",
      JSON.stringify(umpClaimAfterClose.body))
    const nonOwnerClaimAfterClose = await request(`/admin/players/${playerId}/claim-code`, {
      method: 'POST', bearer: peopleAdmin,
    })
    check('a non-owner admin cannot reopen an owner-closed player -> 403',
      nonOwnerClaimAfterClose.status === 403 &&
        nonOwnerClaimAfterClose.body.error === 'Only the owner can reopen a closed account',
      JSON.stringify(nonOwnerClaimAfterClose.body))
    const ownerClaimAfterClose = await request(`/admin/players/${playerId}/claim-code`, {
      method: 'POST', bearer: ownerToken,
    })
    check('the owner can still make a new code for the player they closed -> 200',
      ownerClaimAfterClose.status === 200 && Boolean(ownerClaimAfterClose.body.claimCode),
      JSON.stringify(ownerClaimAfterClose.body).slice(0, 80))

    // --- 12b: linking the owner-reopened code must clear the
    // owner-closed mark too, not just the plain closed one -- otherwise
    // a player who comes back this way would stay stuck looking
    // owner-closed forever. Same flow as
    // section('linking a code to an account you already have'): a
    // brand new throwaway account registers on its own, then hands its
    // token to /player/link with the code the owner just re-minted.
    const reopenUsername = `smk_reopen_${pStamp}`.slice(0, 20)
    const reopenPassword = `smk-${uuid()}`
    const reopenName = `Smoke People Reopen ${pStamp}`
    const reopenAccount = await request('/auth/player/register', {
      method: 'POST',
      body: { name: reopenName, username: reopenUsername, password: reopenPassword },
    })
    check('a fresh throwaway account registers -> 201', reopenAccount.status === 201,
      JSON.stringify(reopenAccount.body).slice(0, 80))
    const reopenId = reopenAccount.body.player?.id
    if (reopenId) selfRegistered.push(reopenId)
    const reopenToken = reopenAccount.body.token

    const reopenLink = await request('/player/link', {
      method: 'POST',
      bearer: reopenToken,
      body: { code: ownerClaimAfterClose.body.claimCode, confirm: true },
    })
    check('linking the owner-reopened code merges -> 200', reopenLink.status === 200,
      JSON.stringify(reopenLink.body).slice(0, 120))
    check('the owner-closed player\'s row is the one that survives',
      reopenLink.body.player?.id === playerId, `${reopenLink.body.player?.id} vs ${playerId}`)

    const claimCodeAfterLink = await request(`/players/${playerId}/claim-code`, { bearer: umpToken })
    check('the umpire route mints a code for the reopened row -> 200, not the owner-only 403',
      claimCodeAfterLink.status === 200 && Boolean(claimCodeAfterLink.body.claimCode),
      JSON.stringify(claimCodeAfterLink.body).slice(0, 80))

    const peopleAdminOff = await request(`/admin/admins/${peopleAdminId}/switch-off`, { method: 'POST', bearer: ownerToken })
    check('the owner switches the throwaway admin off -> 200',
      peopleAdminOff.status === 200 && peopleAdminOff.body.admin?.active === false, String(peopleAdminOff.status))

    const closeUmp = await request(`/admin/umpires/${umpireId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke test done', confirmName: umpName },
    })
    check('closing the umpire -> 200, status closed',
      closeUmp.status === 200 && closeUmp.body.umpire?.status === 'closed', JSON.stringify(closeUmp.body).slice(0, 80))
    const umpDetailAfter = await request(`/admin/umpires/${umpireId}`, { bearer: ownerToken })
    check('its email is the closed placeholder',
      umpDetailAfter.body.umpire?.email === `closed+${umpireId}@paddlepad.invalid`, umpDetailAfter.body.umpire?.email)
    const oldPwLogin = await request('/auth/login', { method: 'POST', body: { email: umpEmail, password: umpPassword } })
    check('the old password no longer signs in -> 401', oldPwLogin.status === 401, String(oldPwLogin.status))
    const closeUmpAgain = await request(`/admin/umpires/${umpireId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'again', confirmName: umpName },
    })
    check('closing the umpire again -> 409', closeUmpAgain.status === 409, String(closeUmpAgain.status))

    // --- 13: closing is recorded exactly once, wrong-name and repeat attempts add nothing ---
    const playerClosedCount = await countByAction('player.closed', playerId, ownerToken)
    check('exactly one player.closed entry; the wrong-name attempt added none',
      playerClosedCount === 1, String(playerClosedCount))
    const umpireClosedCount = await countByAction('umpire.closed', umpireId, ownerToken)
    check('exactly one umpire.closed entry; closing it again added none',
      umpireClosedCount === 1, String(umpireClosedCount))

    // --- 14: a closed umpire's existing token ends the session, not just future sign-ins ---
    const umpTokenAfterClose = await request('/auth/me', { bearer: umpToken })
    check('the closed umpire\'s existing token -> 401, status closed',
      umpTokenAfterClose.status === 401 && umpTokenAfterClose.body.status === 'closed',
      JSON.stringify(umpTokenAfterClose.body))

    // --- 15: the freed email can register again ---
    const reInvite = await request('/admin/invites', {
      method: 'POST', bearer: ownerToken, body: { note: 'smoke people reuse', facilityId: pInviteFacility },
    })
    check('a new invite code is made for the freed email -> 201', reInvite.status === 201,
      JSON.stringify(reInvite.body).slice(0, 80))
    const reUmpName = `Smoke People Umpire ${pStamp} Again`
    const reRegister = await request('/auth/register', {
      method: 'POST',
      body: { email: umpEmail, name: reUmpName, password: `smk-${uuid()}`, invite: reInvite.body.invite?.code },
    })
    check('the freed email can register again with a new invite code -> 201', reRegister.status === 201,
      JSON.stringify(reRegister.body).slice(0, 80))
    const reUmpireId = reRegister.body.umpire?.id
    const reClose = await request(`/admin/umpires/${reUmpireId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke cleanup', confirmName: reUmpName },
    })
    check('and that throwaway is closed too, leaving nothing behind -> 200',
      reClose.status === 200 && reClose.body.umpire?.status === 'closed', JSON.stringify(reClose.body).slice(0, 80))

    // --- 16: the row the reopen-by-linking check revived (12b) is left
    // active by that check on purpose, so the assertions above about
    // it having been closed exactly once still hold; close it again
    // here, after everything else, so nothing is left behind.
    const recloseReopened = await request(`/admin/players/${playerId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke cleanup', confirmName: plName },
    })
    check('closing the reopened-by-link player again -> 200, leaving nothing active',
      recloseReopened.status === 200 && recloseReopened.body.player?.status === 'closed',
      JSON.stringify(recloseReopened.body).slice(0, 80))
  }

  section('admin site — ending sessions, proof and backup codes')
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    const hStamp = Date.now()
    const SESSION_ENDED = 'Your session has ended. Sign in again.'

    // The owner's account is reused across every run of this script, so
    // its activity never starts empty -- a plain count can never read
    // "exactly one". These watermark on the newest entry id for one
    // action against one admin BEFORE doing a thing, then count only
    // entries newer than that after.
    const newestActivityId = async (action, adminId, bearer) => {
      const r = await request(`/admin/activity?action=${action}&adminId=${adminId}`, { bearer })
      return Number((r.body.entries ?? [])[0]?.id ?? 0)
    }
    const newEntriesSince = async (action, adminId, bearer, since) => {
      const r = await request(`/admin/activity?action=${action}&adminId=${adminId}`, { bearer })
      return (r.body.entries ?? []).filter((e) => Number(e.id) > since).length
    }

    // A failure detail below is a JSON dump of a response body -- never
    // one that could itself be a credential. A session token, a set of
    // backup codes, an invite code or a setup link's secret URL is
    // swapped out before it ever reaches JSON.stringify.
    const redacted = (body) => {
      const { token, codes, invite, setupLink, ...rest } = body ?? {}
      return JSON.stringify({
        ...rest,
        ...(token !== undefined ? { token: '[redacted]' } : {}),
        ...(codes !== undefined ? { codes: `[redacted, ${Array.isArray(codes) ? codes.length : 0} codes]` } : {}),
        ...(invite !== undefined ? { invite: { ...invite, code: '[redacted]' } } : {}),
        ...(setupLink !== undefined ? { setupLink: '[redacted]' } : {}),
      })
    }

    // --- 1: signing out everywhere else ends every OTHER session, not this one ---
    const loginA = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('the owner signs in for token A -> 200', loginA.status === 200, redacted(loginA.body).slice(0, 80))
    const tokenA = loginA.body.token
    const ownerId = loginA.body.admin?.id

    const loginB = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('a second sign-in for token B -> 200', loginB.status === 200, String(loginB.status))
    const tokenB = loginB.body.token

    await intoALaterSecond()
    const signedOutWatermark = await newestActivityId('admin.signed_out_others', ownerId, tokenB)
    const signedOut = await request('/admin/auth/me/sign-out-others', { method: 'POST', bearer: tokenB })
    check('sign-out-others with token B -> 200 with a fresh token',
      signedOut.status === 200 && typeof signedOut.body.token === 'string', redacted(signedOut.body).slice(0, 80))
    let ownerToken = signedOut.body.token

    const aEnded = await request('/admin/auth/me', { bearer: tokenA })
    check('token A has ended -> 401', aEnded.status === 401 && aEnded.body.error === SESSION_ENDED, redacted(aEnded.body))
    const cWorks = await request('/admin/auth/me', { bearer: ownerToken })
    check('token C (the fresh one) still works', cWorks.status === 200, String(cWorks.status))
    const signedOutAdded = await newEntriesSince('admin.signed_out_others', ownerId, ownerToken, signedOutWatermark)
    check('one admin.signed_out_others entry', signedOutAdded === 1, String(signedOutAdded))

    // --- 2: proof before a password change, and a temporary password
    // that is always changed back, even if a step in between throws. ---
    const pwWatermark = await newestActivityId('admin.password_changed', ownerId, ownerToken)
    const wrongCurrent = await request('/admin/auth/me/password', {
      method: 'POST', bearer: ownerToken, body: { currentPassword: 'definitely-the-wrong-password', newPassword: 'a-temporary-password-1' },
    })
    check('a wrong currentPassword -> 403', wrongCurrent.status === 403 && wrongCurrent.body.error === 'Your current password is wrong',
      redacted(wrongCurrent.body))
    const noEntryYet = await newEntriesSince('admin.password_changed', ownerId, ownerToken, pwWatermark)
    check('the wrong attempt added no activity entry', noEntryYet === 0, String(noEntryYet))

    const TEMP_PASSWORD = `smoke-temp-${uuid()}`
    let restored = false
    try {
      const beforeChangeToken = ownerToken
      await intoALaterSecond()
      const toTemp = await request('/admin/auth/me/password', {
        method: 'POST', bearer: ownerToken, body: { currentPassword: OWNER_PASSWORD, newPassword: TEMP_PASSWORD },
      })
      check('the right currentPassword changes it -> 200 with a fresh token',
        toTemp.status === 200 && typeof toTemp.body.token === 'string', redacted(toTemp.body).slice(0, 80))
      ownerToken = toTemp.body.token

      const oldEnded = await request('/admin/auth/me', { bearer: beforeChangeToken })
      check('the token from before the change has ended -> 401',
        oldEnded.status === 401 && oldEnded.body.error === SESSION_ENDED, redacted(oldEnded.body))
    } finally {
      // Try changing it back with the temporary password first; if that
      // is refused, the change to temporary may itself never have gone
      // through, so check whether the smoke password already still works.
      let back = await request('/admin/auth/me/password', {
        method: 'POST', bearer: ownerToken, body: { currentPassword: TEMP_PASSWORD, newPassword: OWNER_PASSWORD },
      })
      if (back.status === 200 && typeof back.body.token === 'string') {
        ownerToken = back.body.token
        restored = true
      } else {
        const already = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
        if (already.status === 200) {
          ownerToken = already.body.token
          restored = true
        }
      }
      check('the smoke owner password is back to what it was', restored)
      if (!restored) {
        console.log('\n  !!!! could not confirm the smoke owner password was restored -- fix it by hand before running this again !!!!')
      }
    }
    if (!restored) {
      console.log(`\n${pass} passed, ${fail} failed`)
      process.exit(1)
    }
    const signInAgain = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('signing in with the smoke password works at the end of the section', signInAgain.status === 200, String(signInAgain.status))
    ownerToken = signInAgain.body.token

    // --- 3: a throwaway admin -- switching off ends its sessions even
    // though switching back on does not bring them back. ---
    const hAdminFacility = await anyFacilityId(ownerToken)
    const hAdminEmail = `smoke.hardening.${uuid().slice(0, 8)}@example.com`
    const hAdminAdded = await request('/admin/admins', {
      method: 'POST', bearer: ownerToken, body: { name: 'Smoke Hardening Admin', email: hAdminEmail, facilityId: hAdminFacility },
    })
    check('the owner adds a throwaway admin -> 201', hAdminAdded.status === 201, redacted(hAdminAdded.body).slice(0, 80))
    const hAdminId = hAdminAdded.body.admin?.id
    const hSecret = (hAdminAdded.body.setupLink?.url ?? '').split('/setup/')[1]
    const HARDENING_ADMIN_PASSWORD = `smoke-${uuid()}`
    const hSetup = await request(`/admin/auth/setup/${hSecret}`, { method: 'POST', body: { password: HARDENING_ADMIN_PASSWORD } })
    check('it completes setup through the API and signs in -> 200',
      hSetup.status === 200 && typeof hSetup.body.token === 'string', redacted(hSetup.body).slice(0, 80))
    let hAdminToken = hSetup.body.token

    // Setup itself resets sessions and pins this token to that second,
    // so the switch-off below has to land in a later one.
    await intoALaterSecond()

    const hOff = await request(`/admin/admins/${hAdminId}/switch-off`, { method: 'POST', bearer: ownerToken })
    check('the owner switches it off -> 200', hOff.status === 200 && hOff.body.admin?.active === false, String(hOff.status))
    const hOn = await request(`/admin/admins/${hAdminId}/switch-on`, { method: 'POST', bearer: ownerToken })
    check('and back on -> 200', hOn.status === 200 && hOn.body.admin?.active === true, String(hOn.status))

    const hOldTokenAfter = await request('/admin/auth/me', { bearer: hAdminToken })
    check('its token from before the switch-off has ended -> 401',
      hOldTokenAfter.status === 401 && hOldTokenAfter.body.error === SESSION_ENDED, redacted(hOldTokenAfter.body))

    const hSignInAgain = await request('/admin/auth/login', { method: 'POST', body: { email: hAdminEmail, password: HARDENING_ADMIN_PASSWORD } })
    check('it signs in again fine -> 200', hSignInAgain.status === 200, String(hSignInAgain.status))
    hAdminToken = hSignInAgain.body.token

    const hNoCodes = await request('/admin/auth/me/backup-codes', { method: 'POST', bearer: hAdminToken, body: {} })
    check('a non-owner asking for backup codes -> 403',
      hNoCodes.status === 403 && hNoCodes.body.error === 'Only the owner has backup codes', redacted(hNoCodes.body))
    const hBadBackup = await request('/admin/auth/backup-code', { method: 'POST', body: { email: hAdminEmail, code: 'ACDEF-GHJKM' } })
    check("a non-owner's email and any code -> 401",
      hBadBackup.status === 401 && hBadBackup.body.error === "That email and backup code don't match", redacted(hBadBackup.body))

    const hOffAgain = await request(`/admin/admins/${hAdminId}/switch-off`, { method: 'POST', bearer: ownerToken })
    check('the throwaway admin is left switched off -> 200',
      hOffAgain.status === 200 && hOffAgain.body.admin?.active === false, String(hOffAgain.status))

    // --- 4: the owner's own backup codes ---
    const bcWrong = await request('/admin/auth/me/backup-codes', { method: 'POST', bearer: ownerToken, body: { currentPassword: 'definitely-the-wrong-password' } })
    check('making backup codes with a wrong currentPassword -> 403',
      bcWrong.status === 403 && bcWrong.body.error === 'Your current password is wrong', redacted(bcWrong.body))

    const bcCreatedWatermark = await newestActivityId('admin.backup_codes_created', ownerId, ownerToken)
    const bcMade = await request('/admin/auth/me/backup-codes', { method: 'POST', bearer: ownerToken, body: { currentPassword: OWNER_PASSWORD } })
    check('the right currentPassword makes 10 codes -> 200',
      bcMade.status === 200 && Array.isArray(bcMade.body.codes) && bcMade.body.codes.length === 10,
      redacted(bcMade.body).slice(0, 80))
    const CODE_PATTERN = /^[ACDEFGHJKMNPQRTUVWXY2346789]{5}-[ACDEFGHJKMNPQRTUVWXY2346789]{5}$/
    const madeCodes = bcMade.body.codes ?? []
    // Never the codes themselves, or any part of one -- just which
    // positions (if any) didn't match, and how many there were.
    const badCodeIndexes = madeCodes.map((c, i) => (CODE_PATTERN.test(c) ? -1 : i)).filter((i) => i !== -1)
    check('every code is XXXXX-XXXXX from the invite alphabet', badCodeIndexes.length === 0,
      `${madeCodes.length} codes, bad indexes: ${JSON.stringify(badCodeIndexes)}`)
    check('a fresh token comes with them', typeof bcMade.body.token === 'string')
    ownerToken = bcMade.body.token
    const bcCreatedAdded = await newEntriesSince('admin.backup_codes_created', ownerId, ownerToken, bcCreatedWatermark)
    check('one admin.backup_codes_created entry', bcCreatedAdded === 1, String(bcCreatedAdded))

    const meAfterCodes = await request('/admin/auth/me', { bearer: ownerToken })
    check('backupCodesLeft is 10', meAfterCodes.body.backupCodesLeft === 10, String(meAfterCodes.body.backupCodesLeft))

    const firstCode = bcMade.body.codes[0]
    const messyCode = firstCode.toLowerCase().replace('-', '')
    const bcUsedWatermark = await newestActivityId('admin.backup_code_used', ownerId, ownerToken)
    const tokenBeforeBackupUse = ownerToken
    await intoALaterSecond()
    const bcUse = await request('/admin/auth/backup-code', { method: 'POST', body: { email: OWNER_EMAIL, code: messyCode } })
    check('a lower-cased, dash-less code signs in -> 200, usedBackupCode',
      bcUse.status === 200 && bcUse.body.usedBackupCode === true, redacted(bcUse.body).slice(0, 80))
    ownerToken = bcUse.body.token

    const bcReuse = await request('/admin/auth/backup-code', { method: 'POST', body: { email: OWNER_EMAIL, code: messyCode } })
    check('the same code again -> 401',
      bcReuse.status === 401 && bcReuse.body.error === "That email and backup code don't match", redacted(bcReuse.body))

    const meAfterUse = await request('/admin/auth/me', { bearer: ownerToken })
    check('backupCodesLeft is now 9', meAfterUse.body.backupCodesLeft === 9, String(meAfterUse.body.backupCodesLeft))
    check('and this session still answers viaBackupCode true, before it is used to repair anything',
      meAfterUse.body.viaBackupCode === true, String(meAfterUse.body.viaBackupCode))

    const olderEnded = await request('/admin/auth/me', { bearer: tokenBeforeBackupUse })
    check("the owner's older token has ended -> 401",
      olderEnded.status === 401 && olderEnded.body.error === SESSION_ENDED, redacted(olderEnded.body))

    const bcUsedAdded = await newEntriesSince('admin.backup_code_used', ownerId, ownerToken, bcUsedWatermark)
    check('one admin.backup_code_used entry', bcUsedAdded === 1, String(bcUsedAdded))

    // --- 4b: the session that backup-code sign-in just opened can
    // actually repair the account -- set a new password with no
    // currentPassword at all -- which is the whole point of a backup
    // code existing (Important I1). There is only one owner on staging,
    // so this runs against the real smoke owner and restores its real
    // password in a finally, exactly as case 2 above does; the
    // temporary password is never printed. ---
    const BACKUP_TEMP_PASSWORD = `smoke-temp-${uuid()}`
    let backupProofRestored = false
    try {
      const viaBackupCodeToken = ownerToken
      const setFromBackupCode = await request('/admin/auth/me/password', {
        method: 'POST', bearer: viaBackupCodeToken, body: { newPassword: BACKUP_TEMP_PASSWORD },
      })
      check('a backup-code session sets a password with no currentPassword -> 200 with a fresh token',
        setFromBackupCode.status === 200 && typeof setFromBackupCode.body.token === 'string',
        redacted(setFromBackupCode.body).slice(0, 80))
      check('and the fresh token no longer answers viaBackupCode true, so the shortcut does not carry forward',
        setFromBackupCode.body.viaBackupCode === false, String(setFromBackupCode.body.viaBackupCode))
      ownerToken = setFromBackupCode.body.token

      const secondChangeNoProof = await request('/admin/auth/me/password', {
        method: 'POST', bearer: ownerToken, body: { newPassword: `smoke-temp-${uuid()}` },
      })
      check('a further change with that token and no currentPassword is refused -> 403',
        secondChangeNoProof.status === 403, redacted(secondChangeNoProof.body))
    } finally {
      let back = await request('/admin/auth/me/password', {
        method: 'POST', bearer: ownerToken, body: { currentPassword: BACKUP_TEMP_PASSWORD, newPassword: OWNER_PASSWORD },
      })
      if (back.status === 200 && typeof back.body.token === 'string') {
        ownerToken = back.body.token
        backupProofRestored = true
      } else {
        const already = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
        if (already.status === 200) {
          ownerToken = already.body.token
          backupProofRestored = true
        }
      }
      check('the smoke owner password is back to what it was after the backup-code proof check', backupProofRestored)
      if (!backupProofRestored) {
        console.log('\n  !!!! could not confirm the smoke owner password was restored after the backup-code proof check -- fix it by hand before running this again !!!!')
      }
    }
    if (!backupProofRestored) {
      console.log(`\n${pass} passed, ${fail} failed`)
      process.exit(1)
    }

    // --- 5: a used invite code cannot be cancelled ---
    const hInviteFacility = await anyFacilityId(ownerToken)
    const hInvite = await request('/admin/invites', {
      method: 'POST', bearer: ownerToken, body: { note: 'smoke hardening', facilityId: hInviteFacility },
    })
    check('an invite code is made -> 201', hInvite.status === 201, redacted(hInvite.body).slice(0, 80))
    const hInviteCode = hInvite.body.invite?.code

    const hUmpEmail = `smoke.hardening.umpire.${hStamp}@example.com`
    const hUmpName = `Smoke Hardening Umpire ${hStamp}`
    const hUmpReg = await request('/auth/register', {
      method: 'POST', body: { email: hUmpEmail, name: hUmpName, password: `smk-${uuid()}`, invite: hInviteCode },
    })
    check('the throwaway umpire registers with the code -> 201', hUmpReg.status === 201, redacted(hUmpReg.body).slice(0, 80))
    const hUmpireId = hUmpReg.body.umpire?.id

    const hCancelUsed = await request(`/admin/invites/${hInviteCode}`, { method: 'DELETE', bearer: ownerToken })
    check('a used invite code cannot be cancelled -> 404',
      hCancelUsed.status === 404 && hCancelUsed.body.error === 'No unused invite with that code', redacted(hCancelUsed.body))

    const hCloseUmp = await request(`/admin/umpires/${hUmpireId}/close`, {
      method: 'POST', bearer: ownerToken, body: { reason: 'smoke hardening cleanup', confirmName: hUmpName },
    })
    check('the owner closes the throwaway umpire -> 200',
      hCloseUmp.status === 200 && hCloseUmp.body.umpire?.status === 'closed', redacted(hCloseUmp.body).slice(0, 80))

    // --- 6: disconnecting Google as the only way in is a pure rule,
    // already pinned offline in check-admin-rules.mjs (canDisconnectGoogle) ---
    console.log('  ...  disconnecting Google when it is the only way in is covered by the offline canDisconnectGoogle checks')
  }

  section('admin site — facilities')
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    const fStamp = Date.now()
    const nameFacA = `Smoke Facility A ${fStamp}`
    const nameFacB = `Smoke Facility B ${fStamp}`

    const countByAction = async (action, targetId, bearer) => {
      const activity = await request(`/admin/activity?action=${action}`, { bearer })
      return (activity.body.entries ?? []).filter((e) => e.targetId === targetId).length
    }

    // Same redaction as the hardening section above (out of scope here,
    // since it is declared inside that section's own block) -- never let
    // a token, invite code or setup link reach a failure detail as-is.
    const redacted = (body) => {
      const { token, codes, invite, setupLink, ...rest } = body ?? {}
      return JSON.stringify({
        ...rest,
        ...(token !== undefined ? { token: '[redacted]' } : {}),
        ...(codes !== undefined ? { codes: `[redacted, ${Array.isArray(codes) ? codes.length : 0} codes]` } : {}),
        ...(invite !== undefined ? { invite: { ...invite, code: '[redacted]' } } : {}),
        ...(setupLink !== undefined ? { setupLink: '[redacted]' } : {}),
      })
    }

    const fOwnerIn = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('the owner signs in for the facilities section -> 200', fOwnerIn.status === 200, redacted(fOwnerIn.body).slice(0, 80))
    const fOwnerToken = fOwnerIn.body.token
    const fOwnerId = fOwnerIn.body.admin?.id

    // --- 1: creating facilities ---
    const facA = await request('/admin/facilities', {
      method: 'POST', bearer: fOwnerToken, body: { name: nameFacA, hourlyFee: '150', umpireFee: '100' },
    })
    check('the owner creates facility A -> 201', facA.status === 201, JSON.stringify(facA.body).slice(0, 120))
    const facilityAId = facA.body.facility?.id
    check("facility A's feeText is ₱150 per hour", facA.body.facility?.feeText === '₱150 per hour',
      String(facA.body.facility?.feeText))
    check("facility A's umpireFeeText is ₱100 per hour", facA.body.facility?.umpireFeeText === '₱100 per hour',
      String(facA.body.facility?.umpireFeeText))

    const facB = await request('/admin/facilities', { method: 'POST', bearer: fOwnerToken, body: { name: nameFacB } })
    check('the owner creates facility B -> 201', facB.status === 201, JSON.stringify(facB.body).slice(0, 120))
    const facilityBId = facB.body.facility?.id
    check('facility B has no umpire fee', facB.body.facility?.umpireFeeText === null,
      String(facB.body.facility?.umpireFeeText))

    // --- 1b: what a player sees of the places list ---
    const fPlayer = await asPlayer('/auth/player/register', {
      method: 'POST',
      body: {
        name: `Smoke Facility Reader ${fStamp}`,
        username: `smk_fac_${fStamp}`.slice(0, 20),
        password: 'not-a-real-password',
      },
    })
    if (fPlayer.body.player?.id) selfRegistered.push(fPlayer.body.player.id)
    const playerFacilities = await asPlayer('/player/facilities', { bearer: fPlayer.body.token })
    const facRows = playerFacilities.body.facilities ?? []
    check('/player/facilities -> 200 with every key a player needs',
      playerFacilities.status === 200 && facRows.length > 0 &&
      facRows.every((r) => ['openingHours', 'feeText', 'umpireFeeText'].every((k) => k in r)),
      JSON.stringify(facRows[0] ?? null).slice(0, 160))
    const facARow = facRows.find((r) => r.id === facilityAId)
    check("facility A's row shows the umpire fee to a player",
      facARow?.umpireFeeText === '₱100 per hour', String(facARow?.umpireFeeText))

    const dupeFacility = await request('/admin/facilities', {
      method: 'POST', bearer: fOwnerToken, body: { name: nameFacA.toUpperCase() },
    })
    check('a duplicate name in any case -> 409', dupeFacility.status === 409, String(dupeFacility.status))

    const badLinkFacility = await request('/admin/facilities', {
      method: 'POST', bearer: fOwnerToken,
      body: { name: `Smoke Facility Bad Link ${fStamp}`, locationUrl: 'http://example.com' },
    })
    check('a bad map link -> 400', badLinkFacility.status === 400, String(badLinkFacility.status))

    // --- 2: throwaway admins for A and B ---
    const adminAEmail = `smoke.facility.admin.a.${uuid().slice(0, 8)}@example.com`
    const addedAdminA = await request('/admin/admins', {
      method: 'POST', bearer: fOwnerToken,
      body: { name: `Smoke Facility Admin A ${fStamp}`, email: adminAEmail, facilityId: facilityAId },
    })
    check('the owner adds admin A with facility A -> 201', addedAdminA.status === 201, redacted(addedAdminA.body).slice(0, 100))
    const adminAId = addedAdminA.body.admin?.id
    check('admin A carries facilityId A', addedAdminA.body.admin?.facilityId === facilityAId,
      String(addedAdminA.body.admin?.facilityId))
    const adminASecret = (addedAdminA.body.setupLink?.url ?? '').split('/setup/')[1]
    const ADMIN_A_PASSWORD = `smoke-${uuid()}`
    const adminASetup = await request(`/admin/auth/setup/${adminASecret}`, { method: 'POST', body: { password: ADMIN_A_PASSWORD } })
    check('admin A completes setup through the API -> 200', adminASetup.status === 200, redacted(adminASetup.body).slice(0, 80))
    const adminAIn = await request('/admin/auth/login', { method: 'POST', body: { email: adminAEmail, password: ADMIN_A_PASSWORD } })
    check('admin A signs in -> 200', adminAIn.status === 200, String(adminAIn.status))
    const adminAToken = adminAIn.body.token

    const adminBEmail = `smoke.facility.admin.b.${uuid().slice(0, 8)}@example.com`
    const addedAdminB = await request('/admin/admins', {
      method: 'POST', bearer: fOwnerToken,
      body: { name: `Smoke Facility Admin B ${fStamp}`, email: adminBEmail, facilityId: facilityBId },
    })
    check('the owner adds admin B with facility B -> 201', addedAdminB.status === 201, redacted(addedAdminB.body).slice(0, 100))
    const adminBId = addedAdminB.body.admin?.id
    const adminBSecret = (addedAdminB.body.setupLink?.url ?? '').split('/setup/')[1]
    const ADMIN_B_PASSWORD = `smoke-${uuid()}`
    const adminBSetup = await request(`/admin/auth/setup/${adminBSecret}`, { method: 'POST', body: { password: ADMIN_B_PASSWORD } })
    check('admin B completes setup through the API -> 200', adminBSetup.status === 200, redacted(adminBSetup.body).slice(0, 80))
    const adminBIn = await request('/admin/auth/login', { method: 'POST', body: { email: adminBEmail, password: ADMIN_B_PASSWORD } })
    check('admin B signs in -> 200', adminBIn.status === 200, String(adminBIn.status))

    // An admin with no facility at all: this API always requires a real
    // facilityId to add one (POST /admin/admins refuses otherwise), so
    // there is no way to reach that state here without writing to the
    // database directly -- which this script never does. The rule for
    // what such an admin sees (nothing) is pinned offline instead, in
    // check-facility-rules.mjs (facilityFilterFor's `{ none }` cases).
    console.log('  ...  an admin with no facility seeing and managing nothing is covered by the offline facilityFilterFor checks; this API has no way to create one to test live')

    // --- 3: invite codes join the right facility ---
    const inviteA = await request('/admin/invites', {
      method: 'POST', bearer: adminAToken, body: { note: 'smoke facility a', facilityId: facilityBId },
    })
    check('admin A makes an invite code (a sent facilityId is ignored) -> 201', inviteA.status === 201,
      redacted(inviteA.body).slice(0, 80))
    check("the code belongs to A, not the B it tried to send", inviteA.body.invite?.facilityId === facilityAId,
      String(inviteA.body.invite?.facilityId))
    const inviteACode = inviteA.body.invite?.code

    const umpAEmail = `smoke.facility.umpire.a.${fStamp}@example.com`
    const umpAName = `Smoke Facility Umpire A ${fStamp}`
    const umpAReg = await request('/auth/register', {
      method: 'POST', body: { email: umpAEmail, name: umpAName, password: `smk-${uuid()}`, invite: inviteACode },
    })
    check('the throwaway umpire registers into facility A -> 201', umpAReg.status === 201, redacted(umpAReg.body).slice(0, 80))
    const umpireAId = umpAReg.body.umpire?.id
    const umpAToken = umpAReg.body.token

    const umpADetail = await request(`/admin/umpires/${umpireAId}`, { bearer: fOwnerToken })
    check("umpire A's detail shows facility A", umpADetail.body.umpire?.facilityId === facilityAId,
      String(umpADetail.body.umpire?.facilityId))

    const inviteB = await request('/admin/invites', {
      method: 'POST', bearer: fOwnerToken, body: { note: 'smoke facility b', facilityId: facilityBId },
    })
    check('the owner makes a code for B -> 201', inviteB.status === 201, redacted(inviteB.body).slice(0, 80))
    const inviteBCode = inviteB.body.invite?.code

    const umpBEmail = `smoke.facility.umpire.b.${fStamp}@example.com`
    const umpBName = `Smoke Facility Umpire B ${fStamp}`
    const umpBReg = await request('/auth/register', {
      method: 'POST', body: { email: umpBEmail, name: umpBName, password: `smk-${uuid()}`, invite: inviteBCode },
    })
    check('the throwaway umpire registers into facility B -> 201', umpBReg.status === 201, redacted(umpBReg.body).slice(0, 80))
    const umpireBId = umpBReg.body.umpire?.id
    const umpBToken = umpBReg.body.token

    // GET /admin/invites once crashed on a bad argument -- check it
    // plainly works for the owner and for a facility admin.
    const invitesAsOwner = await request('/admin/invites', { bearer: fOwnerToken })
    check('GET /admin/invites works for the owner -> 200', invitesAsOwner.status === 200, String(invitesAsOwner.status))
    const invitesAsAdminA = await request('/admin/invites', { bearer: adminAToken })
    check('GET /admin/invites works for a facility admin -> 200', invitesAsAdminA.status === 200, String(invitesAsAdminA.status))

    // --- 4: admin A's umpire list and detail are scoped to A ---
    const umpiresAsA = await request(`/admin/umpires?q=${fStamp}`, { bearer: adminAToken })
    const idsAsA = (umpiresAsA.body.umpires ?? []).map((u) => u.id)
    check('admin A lists umpire A, not B', idsAsA.includes(umpireAId) && !idsAsA.includes(umpireBId), JSON.stringify(idsAsA))

    const umpBAsA = await request(`/admin/umpires/${umpireBId}`, { bearer: adminAToken })
    check("admin A reading umpire B's detail -> 404", umpBAsA.status === 404, String(umpBAsA.status))

    const pauseBAsA = await request(`/admin/umpires/${umpireBId}/pause`, {
      method: 'POST', bearer: adminAToken, body: { reason: 'smoke test' },
    })
    check('admin A pausing umpire B -> 404', pauseBAsA.status === 404, String(pauseBAsA.status))

    const pauseAAsA = await request(`/admin/umpires/${umpireAId}/pause`, {
      method: 'POST', bearer: adminAToken, body: { reason: 'smoke test' },
    })
    check('admin A pausing umpire A works -> 200, status paused',
      pauseAAsA.status === 200 && pauseAAsA.body.umpire?.status === 'paused', JSON.stringify(pauseAAsA.body).slice(0, 80))
    const unpauseAAsA = await request(`/admin/umpires/${umpireAId}/unpause`, { method: 'POST', bearer: adminAToken })
    check('and switching it back on works -> 200, status active',
      unpauseAAsA.status === 200 && unpauseAAsA.body.umpire?.status === 'active', JSON.stringify(unpauseAAsA.body).slice(0, 80))

    // --- 5: admin A's facility list and edits are scoped to A ---
    const facilitiesAsA = await request('/admin/facilities', { bearer: adminAToken })
    const facIdsAsA = (facilitiesAsA.body.facilities ?? []).map((f) => f.id)
    check('admin A sees only facility A', facIdsAsA.length === 1 && facIdsAsA[0] === facilityAId, JSON.stringify(facIdsAsA))

    // The owner's facility table shows each facility's umpire and admin
    // counts from the list alone: fetching every facility's page for them
    // used a request per facility and ran the owner into the rate limit.
    const ownerList = await request('/admin/facilities', { bearer: fOwnerToken })
    const listedA = (ownerList.body.facilities ?? []).find((f) => f.id === facilityAId)
    const pageA = await request(`/admin/facilities/${facilityAId}`, { bearer: fOwnerToken })
    check("the facility list carries each facility's umpire and admin counts, matching its page",
      listedA?.umpireCount === pageA.body.umpires?.length && listedA?.adminCount === pageA.body.admins?.length
        && listedA.umpireCount > 0 && listedA.adminCount > 0,
      JSON.stringify({ list: [listedA?.umpireCount, listedA?.adminCount], page: [pageA.body.umpires?.length, pageA.body.admins?.length] }))

    const patchBAsA = await request(`/admin/facilities/${facilityBId}`, {
      method: 'PATCH', bearer: adminAToken, body: { openingHours: 'Mon-Sun 6am-10pm' },
    })
    check('admin A patching facility B -> 404', patchBAsA.status === 404, String(patchBAsA.status))

    const beforeFacUpdated = await countByAction('facility.updated', facilityAId, fOwnerToken)
    const patchAAsA = await request(`/admin/facilities/${facilityAId}`, {
      method: 'PATCH', bearer: adminAToken, body: { openingHours: 'Mon-Sun 6am-10pm' },
    })
    check("admin A patching facility A's openingHours works -> 200",
      patchAAsA.status === 200 && patchAAsA.body.facility?.openingHours === 'Mon-Sun 6am-10pm',
      JSON.stringify(patchAAsA.body).slice(0, 100))
    const afterFacUpdated = await countByAction('facility.updated', facilityAId, fOwnerToken)
    check('exactly one facility.updated entry was written', afterFacUpdated === beforeFacUpdated + 1,
      `${beforeFacUpdated} -> ${afterFacUpdated}`)

    const patchAAsANoChange = await request(`/admin/facilities/${facilityAId}`, {
      method: 'PATCH', bearer: adminAToken, body: { openingHours: 'Mon-Sun 6am-10pm' },
    })
    check('saving facility A again with the same value -> 200', patchAAsANoChange.status === 200,
      String(patchAAsANoChange.status))
    const afterFacUpdatedNoChange = await countByAction('facility.updated', facilityAId, fOwnerToken)
    check('a save with no actual change writes no facility.updated entry',
      afterFacUpdatedNoChange === afterFacUpdated, `${afterFacUpdated} -> ${afterFacUpdatedNoChange}`)

    // --- 6: pausing players stays the owner's alone ---
    const plName = `Smoke Facility Player ${fStamp}`
    const plCreated = await request('/players', { method: 'POST', bearer: umpAToken, body: { name: plName } })
    check('umpire A creates a throwaway player -> 201', plCreated.status === 201, JSON.stringify(plCreated.body).slice(0, 80))
    const facPlayerId = plCreated.body.player?.id

    const pauseByAdminA = await request(`/admin/players/${facPlayerId}/pause`, {
      method: 'POST', bearer: adminAToken, body: { reason: 'smoke test' },
    })
    check('admin A pausing a player -> 403, Only the owner can pause players',
      pauseByAdminA.status === 403 && pauseByAdminA.body.error === 'Only the owner can pause players',
      JSON.stringify(pauseByAdminA.body))

    const pauseByOwner = await request(`/admin/players/${facPlayerId}/pause`, {
      method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke test' },
    })
    check('the owner can still pause the player -> 200, status paused',
      pauseByOwner.status === 200 && pauseByOwner.body.player?.status === 'paused', JSON.stringify(pauseByOwner.body).slice(0, 80))
    const unpauseByOwner = await request(`/admin/players/${facPlayerId}/unpause`, { method: 'POST', bearer: fOwnerToken })
    check('and switch it back on -> 200, status active',
      unpauseByOwner.status === 200 && unpauseByOwner.body.player?.status === 'active',
      JSON.stringify(unpauseByOwner.body).slice(0, 80))

    // --- 7: activity is scoped by facility ---
    const activityAsA = await request('/admin/activity', { bearer: adminAToken })
    const namesInA = (activityAsA.body.entries ?? []).map((e) => e.facilityName)
    check("admin A's activity has none of facility B's entries", !namesInA.includes(nameFacB), JSON.stringify([...new Set(namesInA)]))
    check("admin A's activity has facility A's entries", namesInA.includes(nameFacA), JSON.stringify([...new Set(namesInA)]))

    const activityFilterB = await request(`/admin/activity?facilityId=${facilityBId}`, { bearer: fOwnerToken })
    const namesFilterB = (activityFilterB.body.entries ?? []).map((e) => e.facilityName)
    check("the owner's filter by B shows only B's entries",
      namesFilterB.length > 0 && namesFilterB.every((n) => n === nameFacB), JSON.stringify([...new Set(namesFilterB)]))

    // --- 7b: the umpire app sees only its own facility ---
    // A's umpire and B's umpire were registered above through real
    // invite codes, so these are the genuine tokens the app would hold.
    // Runs here, before umpire A is moved to facility B below, so both
    // umpires are still genuinely at their own facilities.
    const sessionAId = uuid()
    const madeSessionA = await request('/sessions', {
      method: 'POST', bearer: umpAToken,
      body: { id: sessionAId, name: `Smoke Facility A session ${fStamp}` },
    })
    check("A's umpire opens a session -> 201", madeSessionA.status === 201, String(madeSessionA.status))

    const sessionBId = uuid()
    const madeSessionB = await request('/sessions', {
      method: 'POST', bearer: umpBToken,
      body: { id: sessionBId, name: `Smoke Facility B session ${fStamp}` },
    })
    check("B's umpire opens a session -> 201", madeSessionB.status === 201, String(madeSessionB.status))

    const listForA = await request('/sessions', { bearer: umpAToken })
    const idsForA = (listForA.body.sessions ?? []).map((s) => s.id)
    check("A's list holds A's session", idsForA.includes(sessionAId), String(idsForA.length))
    check("A's list does NOT hold B's session", !idsForA.includes(sessionBId), 'B leaked into A')

    const readBAsA = await request(`/sessions/${sessionBId}`, { bearer: umpAToken })
    check("A's umpire reading B's session -> 404", readBAsA.status === 404, String(readBAsA.status))

    const rosterBAsA = await request(`/sessions/${sessionBId}/players`, {
      method: 'PUT', bearer: umpAToken, body: { playerIds: [] },
    })
    check("A's umpire editing B's roster -> 404", rosterBAsA.status === 404, String(rosterBAsA.status))

    const endBAsA = await request(`/sessions/${sessionBId}/end`, {
      method: 'POST', bearer: umpAToken, body: { ended: true },
    })
    check("A's umpire ending B's session -> 404", endBAsA.status === 404, String(endBAsA.status))

    const voidBAsA = await request(`/sessions/${sessionBId}/void`, {
      method: 'POST', bearer: umpAToken, body: { voided: true, reason: 'smoke' },
    })
    check("A's umpire voiding B's session -> 404", voidBAsA.status === 404, String(voidBAsA.status))

    const deleteBAsA = await request(`/sessions/${sessionBId}`, { method: 'DELETE', bearer: umpAToken })
    check("A's umpire deleting B's session -> 404", deleteBAsA.status === 404, String(deleteBAsA.status))

    // B's session must still be there -- the refusals above must refuse,
    // not quietly succeed.
    const stillThere = await request(`/sessions/${sessionBId}`, { bearer: umpBToken })
    check("B's session survived every one of A's attempts -> 200", stillThere.status === 200,
      String(stillThere.status))
    check("B's session was not ended by A", !stillThere.body.session?.ended_at,
      String(stillThere.body.session?.ended_at))
    check("B's session was not voided by A", !stillThere.body.session?.voided_at,
      String(stillThere.body.session?.voided_at))

    // A match at B, reached by A.
    const playerB1 = await request('/players', {
      method: 'POST', bearer: umpBToken, body: { name: `Smoke Fac B One ${fStamp}` },
    })
    const playerB2 = await request('/players', {
      method: 'POST', bearer: umpBToken, body: { name: `Smoke Fac B Two ${fStamp}` },
    })
    const bOne = playerB1.body.player?.id
    const bTwo = playerB2.body.player?.id
    await request(`/sessions/${sessionBId}/players`, {
      method: 'PUT', bearer: umpBToken, body: { playerIds: [bOne, bTwo] },
    })

    const matchBId = uuid()
    const madeMatchB = await request('/matches', {
      method: 'POST', bearer: umpBToken,
      body: {
        id: matchBId, sessionId: sessionBId, teamA: [bOne], teamB: [bTwo],
        firstServer: { team: 'A', playerId: bOne },
      },
    })
    check("B's umpire starts a match -> 201", madeMatchB.status === 201, JSON.stringify(madeMatchB.body).slice(0, 120))

    const readMatchAsA = await request(`/matches/${matchBId}`, { bearer: umpAToken })
    check("A's umpire reading B's match -> 404", readMatchAsA.status === 404, String(readMatchAsA.status))

    const listMatchesAsA = await request(`/matches/session/${sessionBId}`, { bearer: umpAToken })
    check("A's umpire listing B's session's matches -> empty",
      (listMatchesAsA.body.matches ?? []).length === 0, String((listMatchesAsA.body.matches ?? []).length))

    const claimAsA = await request(`/matches/${matchBId}/claim`, {
      method: 'POST', bearer: umpAToken, body: { deviceId: `smoke-${uuid()}`, force: true },
    })
    check("A's umpire taking over B's match -> 404", claimAsA.status === 404, String(claimAsA.status))
    check('the refusal names no umpire', !claimAsA.body?.heldBy, JSON.stringify(claimAsA.body ?? {}).slice(0, 80))

    const logAsA = await request(`/matches/${matchBId}/log`, {
      method: 'PUT', bearer: umpAToken, body: { deviceId: `smoke-${uuid()}`, events: [] },
    })
    check("A's umpire logging to B's match -> 404", logAsA.status === 404, String(logAsA.status))

    const voidMatchAsA = await request(`/matches/${matchBId}/void`, {
      method: 'POST', bearer: umpAToken, body: { voided: true, reason: 'smoke' },
    })
    check("A's umpire voiding B's match -> 404", voidMatchAsA.status === 404, String(voidMatchAsA.status))

    const deleteMatchAsA = await request(`/matches/${matchBId}`, { method: 'DELETE', bearer: umpAToken })
    check("A's umpire deleting B's match -> 404", deleteMatchAsA.status === 404, String(deleteMatchAsA.status))

    const matchIntact = await request(`/matches/${matchBId}`, { bearer: umpBToken })
    check("B's match survived every one of A's attempts -> 200", matchIntact.status === 200,
      String(matchIntact.status))
    check("B's match was not voided by A", !matchIntact.body.match?.voidedAt,
      String(matchIntact.body.match?.voidedAt))

    const smuggled = await request('/matches', {
      method: 'POST', bearer: umpAToken,
      body: {
        id: uuid(), sessionId: sessionBId, teamA: [bOne], teamB: [bTwo],
        firstServer: { team: 'A', playerId: bOne },
      },
    })
    check("A's umpire starting a match in B's session -> 404", smuggled.status === 404, String(smuggled.status))

    // Players stay across everyone: B's new players are in A's roster.
    const playersAsA = await request(`/players?q=${fStamp}`, { bearer: umpAToken })
    const playerIdsAsA = (playersAsA.body.players ?? []).map((p) => p.id)
    check("players are NOT scoped by facility -- A's umpire sees B's players",
      playerIdsAsA.includes(bOne), String(playerIdsAsA.length))

    // The account screen's facility name.
    const meA = await request('/auth/me', { bearer: umpAToken })
    check("A's umpire's account names facility A", meA.body.umpire?.facilityName === nameFacA,
      String(meA.body.umpire?.facilityName))

    // Tidy: end both throwaway sessions as their own umpires.
    await request(`/sessions/${sessionAId}/end`, { method: 'POST', bearer: umpAToken, body: { ended: true } })
    await request(`/sessions/${sessionBId}/end`, { method: 'POST', bearer: umpBToken, body: { ended: true } })

    // --- 9 (done before 8): a session opened while umpire A is still in
    // facility A is stamped with that facility -- checked before the move
    // below relocates it. ---
    const facSessionId = uuid()
    const facSessionCreate = await request('/sessions', {
      method: 'POST', bearer: umpAToken, body: { id: facSessionId, name: `Smoke Facility Session ${fStamp}` },
    })
    check('umpire A opens a session -> 201', facSessionCreate.status === 201, JSON.stringify(facSessionCreate.body).slice(0, 100))
    check("the session is stamped with umpire A's facility",
      facSessionCreate.body.session?.facility_id === facilityAId, String(facSessionCreate.body.session?.facility_id))
    const facSessionGet = await request(`/sessions/${facSessionId}`, { bearer: umpAToken })
    check('and GET /sessions/:id carries the same facility_id',
      facSessionGet.body.session?.facility_id === facilityAId, String(facSessionGet.body.session?.facility_id))
    // Ended now, while umpire A can still reach it: after the move below
    // it belongs to a facility A is no longer in, so the tidy pass at the
    // end of the run cannot end it, and every run left one open.
    const facSessionEnd = await request(`/sessions/${facSessionId}/end`, { method: 'POST', bearer: umpAToken, body: { ended: true } })
    check('and umpire A ends it again -> 200', facSessionEnd.status === 200, String(facSessionEnd.status))

    // --- 8: moving people between facilities ---
    const moveUmpA = await request(`/admin/umpires/${umpireAId}/move`, {
      method: 'POST', bearer: fOwnerToken, body: { facilityId: facilityBId },
    })
    check('the owner moves umpire A to facility B -> 200', moveUmpA.status === 200 && moveUmpA.body.umpire?.facilityId === facilityBId,
      JSON.stringify(moveUmpA.body).slice(0, 100))

    const umpAAsAAfterMove = await request(`/admin/umpires/${umpireAId}`, { bearer: adminAToken })
    check("admin A gets 404 for the umpire that just moved out of their facility",
      umpAAsAAfterMove.status === 404, String(umpAAsAAfterMove.status))

    const moveOwner = await request(`/admin/admins/${fOwnerId}/move`, {
      method: 'POST', bearer: fOwnerToken, body: { facilityId: facilityBId },
    })
    check('moving the owner -> 409', moveOwner.status === 409, String(moveOwner.status))

    // --- 10: cleanup -- close the throwaways, switch off the throwaway
    // admins, and rename the facilities (there is no delete) so the list
    // stays readable. ---
    const closeUmpA = await request(`/admin/umpires/${umpireAId}/close`, {
      method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: umpAName },
    })
    check('closing throwaway umpire A -> 200', closeUmpA.status === 200 && closeUmpA.body.umpire?.status === 'closed',
      JSON.stringify(closeUmpA.body).slice(0, 80))

    const closeUmpB = await request(`/admin/umpires/${umpireBId}/close`, {
      method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: umpBName },
    })
    check('closing throwaway umpire B -> 200', closeUmpB.status === 200 && closeUmpB.body.umpire?.status === 'closed',
      JSON.stringify(closeUmpB.body).slice(0, 80))

    const closeFacPlayer = await request(`/admin/players/${facPlayerId}/close`, {
      method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: plName },
    })
    check('closing the throwaway player -> 200', closeFacPlayer.status === 200 && closeFacPlayer.body.player?.status === 'closed',
      JSON.stringify(closeFacPlayer.body).slice(0, 80))

    const offAdminA = await request(`/admin/admins/${adminAId}/switch-off`, { method: 'POST', bearer: fOwnerToken })
    check('switching off throwaway admin A -> 200', offAdminA.status === 200 && offAdminA.body.admin?.active === false,
      String(offAdminA.status))
    const offAdminB = await request(`/admin/admins/${adminBId}/switch-off`, { method: 'POST', bearer: fOwnerToken })
    check('switching off throwaway admin B -> 200', offAdminB.status === 200 && offAdminB.body.admin?.active === false,
      String(offAdminB.status))

    const renameA = await request(`/admin/facilities/${facilityAId}`, {
      method: 'PATCH', bearer: fOwnerToken, body: { name: `Smoke Facility (old) A ${fStamp}` },
    })
    check('renaming facility A for cleanup -> 200', renameA.status === 200, JSON.stringify(renameA.body).slice(0, 80))
    const renameB = await request(`/admin/facilities/${facilityBId}`, {
      method: 'PATCH', bearer: fOwnerToken, body: { name: `Smoke Facility (old) B ${fStamp}` },
    })
    check('renaming facility B for cleanup -> 200', renameB.status === 200, JSON.stringify(renameB.body).slice(0, 80))
  }

  section('admin site — overview')
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    const stamp = Date.now()
    const nameFacA = `Smoke Overview A ${stamp}`
    const nameFacB = `Smoke Overview B ${stamp}`

    // Same redaction as the other admin sections -- never let a token,
    // invite code or setup link reach a failure detail as-is.
    const redacted = (body) => {
      const { token, codes, invite, setupLink, ...rest } = body ?? {}
      return JSON.stringify({
        ...rest,
        ...(token !== undefined ? { token: '[redacted]' } : {}),
        ...(codes !== undefined ? { codes: `[redacted, ${Array.isArray(codes) ? codes.length : 0} codes]` } : {}),
        ...(invite !== undefined ? { invite: { ...invite, code: '[redacted]' } } : {}),
        ...(setupLink !== undefined ? { setupLink: '[redacted]' } : {}),
      })
    }

    // --- Step 1: two throwaway facilities, one admin and one umpire each ---
    const fOwnerIn = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('the owner signs in for the overview section -> 200', fOwnerIn.status === 200, redacted(fOwnerIn.body).slice(0, 80))
    const fOwnerToken = fOwnerIn.body.token

    const facA = await request('/admin/facilities', { method: 'POST', bearer: fOwnerToken, body: { name: nameFacA } })
    check('the owner creates facility A -> 201', facA.status === 201, redacted(facA.body).slice(0, 120))
    const facilityAId = facA.body.facility?.id
    const facB = await request('/admin/facilities', { method: 'POST', bearer: fOwnerToken, body: { name: nameFacB } })
    check('the owner creates facility B -> 201', facB.status === 201, redacted(facB.body).slice(0, 120))
    const facilityBId = facB.body.facility?.id

    const adminAEmail = `smoke.overview.admin.a.${uuid().slice(0, 8)}@example.com`
    const addedAdminA = await request('/admin/admins', {
      method: 'POST', bearer: fOwnerToken,
      body: { name: `Smoke Overview Admin A ${stamp}`, email: adminAEmail, facilityId: facilityAId },
    })
    check('the owner adds admin A -> 201', addedAdminA.status === 201, redacted(addedAdminA.body).slice(0, 100))
    const adminAId = addedAdminA.body.admin?.id
    const adminASecret = (addedAdminA.body.setupLink?.url ?? '').split('/setup/')[1]
    const ADMIN_A_PASSWORD = `smoke-${uuid()}`
    await request(`/admin/auth/setup/${adminASecret}`, { method: 'POST', body: { password: ADMIN_A_PASSWORD } })
    const adminAIn = await request('/admin/auth/login', { method: 'POST', body: { email: adminAEmail, password: ADMIN_A_PASSWORD } })
    check('admin A signs in -> 200', adminAIn.status === 200, String(adminAIn.status))
    const adminAToken = adminAIn.body.token

    const adminBEmail = `smoke.overview.admin.b.${uuid().slice(0, 8)}@example.com`
    const addedAdminB = await request('/admin/admins', {
      method: 'POST', bearer: fOwnerToken,
      body: { name: `Smoke Overview Admin B ${stamp}`, email: adminBEmail, facilityId: facilityBId },
    })
    check('the owner adds admin B -> 201', addedAdminB.status === 201, redacted(addedAdminB.body).slice(0, 100))
    const adminBId = addedAdminB.body.admin?.id
    const adminBSecret = (addedAdminB.body.setupLink?.url ?? '').split('/setup/')[1]
    const ADMIN_B_PASSWORD = `smoke-${uuid()}`
    await request(`/admin/auth/setup/${adminBSecret}`, { method: 'POST', body: { password: ADMIN_B_PASSWORD } })
    const adminBIn = await request('/admin/auth/login', { method: 'POST', body: { email: adminBEmail, password: ADMIN_B_PASSWORD } })
    check('admin B signs in -> 200', adminBIn.status === 200, String(adminBIn.status))
    const adminBToken = adminBIn.body.token

    const inviteA = await request('/admin/invites', { method: 'POST', bearer: adminAToken, body: { note: 'smoke overview a', facilityId: facilityAId } })
    check('an invite code is made for A -> 201', inviteA.status === 201, redacted(inviteA.body).slice(0, 80))
    const inviteACode = inviteA.body.invite?.code

    const umpAName = `Smoke Overview Umpire A ${stamp}`
    const umpAEmail = `smoke.overview.umpire.a.${stamp}@example.com`
    const umpAReg = await request('/auth/register', {
      method: 'POST', body: { email: umpAEmail, name: umpAName, password: `smk-${uuid()}`, invite: inviteACode },
    })
    check('the throwaway umpire A registers -> 201', umpAReg.status === 201, redacted(umpAReg.body).slice(0, 80))
    const umpireAId = umpAReg.body.umpire?.id
    const umpAToken = umpAReg.body.token

    const inviteB = await request('/admin/invites', { method: 'POST', bearer: adminBToken, body: { note: 'smoke overview b', facilityId: facilityBId } })
    check('an invite code is made for B -> 201', inviteB.status === 201, redacted(inviteB.body).slice(0, 80))
    const inviteBCode = inviteB.body.invite?.code

    const umpBName = `Smoke Overview Umpire B ${stamp}`
    const umpBEmail = `smoke.overview.umpire.b.${stamp}@example.com`
    const umpBReg = await request('/auth/register', {
      method: 'POST', body: { email: umpBEmail, name: umpBName, password: `smk-${uuid()}`, invite: inviteBCode },
    })
    check('the throwaway umpire B registers -> 201', umpBReg.status === 201, redacted(umpBReg.body).slice(0, 80))
    const umpireBId = umpBReg.body.umpire?.id
    const umpBToken = umpBReg.body.token

    // --- Umpire A's players and session: Jon and John are one letter
    // apart on purpose -- they must never share a match, or they stop
    // being a possible duplicate. ---
    const jonName = `Smoke Ov Jon ${stamp}`
    const johnName = `Smoke Ov John ${stamp}`
    const miaName = `Smoke Ov Mia ${stamp}`
    const reyName = `Smoke Ov Rey ${stamp}`
    const jonId = (await request('/players', { method: 'POST', bearer: umpAToken, body: { name: jonName } })).body.player?.id
    const johnId = (await request('/players', { method: 'POST', bearer: umpAToken, body: { name: johnName } })).body.player?.id
    const miaId = (await request('/players', { method: 'POST', bearer: umpAToken, body: { name: miaName } })).body.player?.id
    const reyId = (await request('/players', { method: 'POST', bearer: umpAToken, body: { name: reyName } })).body.player?.id
    check('four throwaway players are created for umpire A', [jonId, johnId, miaId, reyId].every(Boolean))

    const sessionAId = uuid()
    const sessionACreate = await request('/sessions', { method: 'POST', bearer: umpAToken, body: { id: sessionAId, name: `Smoke Overview Session A ${stamp}` } })
    check('umpire A opens a session -> 201', sessionACreate.status === 201, JSON.stringify(sessionACreate.body).slice(0, 100))
    const rosterA1 = await request(`/sessions/${sessionAId}/players`, { method: 'PUT', bearer: umpAToken, body: { playerIds: [jonId, johnId, miaId, reyId] } })
    check('umpire A puts all four on the session -> 200', rosterA1.status === 200 && rosterA1.body.playerIds?.length === 4, JSON.stringify(rosterA1.body))

    // --- Umpire B's own session, with two of its own new players ---
    const plB1Name = `Smoke Ov Umpire B Player One ${stamp}`
    const plB2Name = `Smoke Ov Umpire B Player Two ${stamp}`
    const plB1Id = (await request('/players', { method: 'POST', bearer: umpBToken, body: { name: plB1Name } })).body.player?.id
    const plB2Id = (await request('/players', { method: 'POST', bearer: umpBToken, body: { name: plB2Name } })).body.player?.id
    const sessionBId = uuid()
    const sessionBCreate = await request('/sessions', { method: 'POST', bearer: umpBToken, body: { id: sessionBId, name: `Smoke Overview Session B ${stamp}` } })
    check('umpire B opens a session -> 201', sessionBCreate.status === 201, JSON.stringify(sessionBCreate.body).slice(0, 100))
    const rosterB1 = await request(`/sessions/${sessionBId}/players`, { method: 'PUT', bearer: umpBToken, body: { playerIds: [plB1Id, plB2Id] } })
    check('umpire B puts both players on their own session -> 200', rosterB1.status === 200 && rosterB1.body.playerIds?.length === 2, JSON.stringify(rosterB1.body))

    // --- Step 2: flagged matches ---
    const kaiName = `Smoke Ov Kai ${stamp}`
    const kaiId = (await request('/players', { method: 'POST', bearer: umpAToken, body: { name: kaiName } })).body.player?.id
    const rosterA2 = await request(`/sessions/${sessionAId}/players`, { method: 'PUT', bearer: umpAToken, body: { playerIds: [jonId, johnId, miaId, reyId, kaiId] } })
    check('Kai joins the session roster -> 200', rosterA2.status === 200 && rosterA2.body.playerIds?.length === 5, JSON.stringify(rosterA2.body))

    const m1Id = uuid()
    const m1Create = await request('/matches', {
      method: 'POST', bearer: umpAToken,
      body: {
        id: m1Id, sessionId: sessionAId, teamA: [jonId, miaId], teamB: [reyId, kaiId],
        stacking: { A: false, B: false }, firstServer: { team: 'A', playerId: jonId },
        startedAt: Date.now() - 20 * 60_000,
      },
    })
    check('M1 is created -> 201', m1Create.status === 201, JSON.stringify(m1Create.body).slice(0, 120))
    const m1Log = await request(`/matches/${m1Id}/log`, {
      method: 'PUT', bearer: umpAToken,
      body: { deviceId: DEVICE, events: Array.from({ length: 11 }, (_, i) => rally(i, jonId)) },
    })
    check('M1 is Ended 11-0, completed', m1Log.body.match?.status === 'completed' && m1Log.body.match?.winner === 'A',
      JSON.stringify(m1Log.body).slice(0, 120))

    const m2Id = uuid()
    const m2Create = await request('/matches', {
      method: 'POST', bearer: umpBToken,
      body: {
        id: m2Id, sessionId: sessionBId, teamA: [plB1Id], teamB: [plB2Id],
        firstServer: { team: 'A', playerId: plB1Id },
        startedAt: Date.now() - 20 * 60_000,
      },
    })
    check('M2 is created -> 201', m2Create.status === 201, JSON.stringify(m2Create.body).slice(0, 120))
    const m2Log = await request(`/matches/${m2Id}/log`, {
      method: 'PUT', bearer: umpBToken,
      body: { deviceId: DEVICE, events: Array.from({ length: 11 }, (_, i) => rally(i, plB1Id)) },
    })
    check('M2 is Ended 11-0, completed', m2Log.body.match?.status === 'completed' && m2Log.body.match?.winner === 'A',
      JSON.stringify(m2Log.body).slice(0, 120))

    const ovAsA = await request('/admin/overview', { bearer: adminAToken })
    check('admin A reads the Overview -> 200', ovAsA.status === 200, String(ovAsA.status))
    const m1Warning = ovAsA.body.warnings?.find((w) => w.matchId === m1Id)
    check('M1 is worth a look as a shutout', m1Warning?.reasons?.some((r) => r.reason === 'shutout' && r.tag === 'Ended 11–0'),
      JSON.stringify(m1Warning?.reasons))
    check("admin A never sees facility B's match",
      Array.isArray(ovAsA.body.warnings) && !ovAsA.body.warnings.some((w) => w.matchId === m2Id))
    check('admin A gets no duplicate list', ovAsA.body.duplicates === null, JSON.stringify(ovAsA.body.duplicates)?.slice(0, 80))
    check('the live board counts the open session', ovAsA.body.live?.sessions >= 1, JSON.stringify(ovAsA.body.live))
    check('umpire A counts as active (their session is going on)', ovAsA.body.totals?.umpires?.active >= 1,
      JSON.stringify(ovAsA.body.totals?.umpires))
    const ovAsOwnerB = await request(`/admin/overview?facilityId=${facilityBId}`, { bearer: fOwnerToken })
    check('the owner narrowed to B sees M2 and not M1',
      Array.isArray(ovAsOwnerB.body.warnings) &&
      ovAsOwnerB.body.warnings.some((w) => w.matchId === m2Id) && !ovAsOwnerB.body.warnings.some((w) => w.matchId === m1Id))

    // --- Step 3: buttons, with refusals ---
    const fineOther = await request('/admin/overview/looks-fine', { method: 'POST', bearer: adminAToken, body: { matchId: m2Id, reason: 'shutout' } })
    check("admin A can't mark B's match fine -> 404", fineOther.status === 404, String(fineOther.status))
    const noReason = await request('/admin/overview/void', { method: 'POST', bearer: adminAToken, body: { matchId: m1Id, reason: ' ' } })
    check('void with no reason -> 400', noReason.status === 400, String(noReason.status))
    const voided = await request('/admin/overview/void', { method: 'POST', bearer: adminAToken, body: { matchId: m1Id, reason: 'smoke test void' } })
    check('admin A voids M1 -> 200', voided.status === 200, JSON.stringify(voided.body))
    const m1AsUmpire = await request(`/matches/${m1Id}`, { bearer: umpAToken })
    check('the umpire sees M1 voided with the reason', Boolean(m1AsUmpire.body.match?.voidedAt) && m1AsUmpire.body.match?.voidReason === 'smoke test void')
    const afterVoid = await request('/admin/overview', { bearer: adminAToken })
    check('M1 stays listed as voided, by me', afterVoid.body.warnings?.find((w) => w.matchId === m1Id)?.voided?.byMe === true)
    const undone = await request('/admin/overview/unvoid', { method: 'POST', bearer: adminAToken, body: { matchId: m1Id } })
    check('Undo -> 200', undone.status === 200, JSON.stringify(undone.body))
    const fine = await request('/admin/overview/looks-fine', { method: 'POST', bearer: adminAToken, body: { matchId: m1Id, reason: 'shutout' } })
    check('Looks fine -> 200', fine.status === 200, JSON.stringify(fine.body))
    const afterFine = await request('/admin/overview', { bearer: adminAToken })
    check('M1 is gone from Worth a look',
      Array.isArray(afterFine.body.warnings) && !afterFine.body.warnings.some((w) => w.matchId === m1Id))
    const voidUnflagged = await request('/admin/overview/void', { method: 'POST', bearer: adminAToken, body: { matchId: m1Id, reason: 'x' } })
    check("an unflagged match can't be voided here -> 409", voidUnflagged.status === 409, JSON.stringify(voidUnflagged.body))
    // Each of the four wrote an entry filed under facility A.
    const actA = await request('/admin/activity', { bearer: adminAToken })
    const mine = (actA.body.entries ?? []).filter((e) => e.targetId === m1Id).map((e) => e.action)
    check('Activity has voided, restored and looks-fine for M1',
      ['match.voided', 'match.restored', 'match.looks_fine'].every((a) => mine.includes(a)), JSON.stringify(mine))
    const ownerRoute = await request('/admin/overview/not-same-person', { method: 'POST', bearer: adminAToken, body: { playerIds: [jonId, johnId] } })
    check('a facility admin calling an owner route -> 403',
      ownerRoute.status === 403 && ownerRoute.body.error === 'Only the owner can do that', JSON.stringify(ownerRoute.body))

    // --- Close a session left open: session A is still fresh and going
    // on here, so the guard is what's worth proving -- an actually
    // left-open session can't be manufactured through the API. ---
    const closeFresh = await request(`/admin/overview/sessions/${sessionAId}/close`, { method: 'POST', bearer: adminAToken, body: { reason: 'smoke test close' } })
    check("closing a fresh, active session -> 409 with the exact message",
      closeFresh.status === 409 && closeFresh.body.error === NOT_LEFT_OPEN_MESSAGE, JSON.stringify(closeFresh.body))
    const closeNoReason = await request(`/admin/overview/sessions/${sessionAId}/close`, { method: 'POST', bearer: adminAToken, body: {} })
    check('closing a session with no reason -> 400 with the exact message',
      closeNoReason.status === 400 && closeNoReason.body.error === SESSION_REASON_MESSAGE, JSON.stringify(closeNoReason.body))
    const closeOtherFacility = await request(`/admin/overview/sessions/${sessionAId}/close`, { method: 'POST', bearer: adminBToken, body: { reason: 'smoke test close' } })
    check("admin B closing facility A's session -> 404",
      closeOtherFacility.status === 404 && closeOtherFacility.body.error === 'No such session', JSON.stringify(closeOtherFacility.body))

    // --- Step 4: duplicates and merge ---
    const ovOwnerStart = Date.now()
    const ovOwner = await request('/admin/overview', { bearer: fOwnerToken })
    console.log(`  ...  GET /admin/overview as the owner took ${Date.now() - ovOwnerStart}ms`)
    const pair = ovOwner.body.duplicates?.find((p) => [p.a.id, p.b.id].includes(jonId) && [p.a.id, p.b.id].includes(johnId))
    check('Jon / John are listed as possible duplicates', pair?.reason === 'typo', JSON.stringify(pair)?.slice(0, 120))
    const whileLive = await request('/admin/overview/merge', {
      method: 'POST', bearer: fOwnerToken, body: { keepId: jonId, removeId: johnId, confirmName: johnName },
    })
    check('merge refused while John is on a session going on -> 409', whileLive.status === 409 && whileLive.body.error === 'Try again once their session has ended',
      JSON.stringify(whileLive.body))

    // End umpire A's session, then give John one finished DOUBLES match of
    // his own -- with a right-start pick on his team and both non-rally
    // payload shapes naming him -- so there's something for the merge to
    // move and rewrite.
    const sessionAEnd = await request(`/sessions/${sessionAId}/end`, { method: 'POST', bearer: umpAToken, body: {} })
    check("umpire A ends their session -> 200", sessionAEnd.status === 200, String(sessionAEnd.status))

    const session2Id = uuid()
    const session2Create = await request('/sessions', { method: 'POST', bearer: umpAToken, body: { id: session2Id, name: `Smoke Overview Session A2 ${stamp}` } })
    check('umpire A opens a second session -> 201', session2Create.status === 201, JSON.stringify(session2Create.body).slice(0, 100))
    const sixthName = `Smoke Ov Sixth ${stamp}`
    const sixthId = (await request('/players', { method: 'POST', bearer: umpAToken, body: { name: sixthName } })).body.player?.id
    const roster2 = await request(`/sessions/${session2Id}/players`, { method: 'PUT', bearer: umpAToken, body: { playerIds: [johnId, reyId, kaiId, sixthId] } })
    check('John, Rey, Kai and a sixth player join the second session -> 200',
      roster2.status === 200 && roster2.body.playerIds?.length === 4, JSON.stringify(roster2.body))

    const m3Id = uuid()
    const m3Create = await request('/matches', {
      method: 'POST', bearer: umpAToken,
      body: {
        id: m3Id, sessionId: session2Id, teamA: [johnId, reyId], teamB: [kaiId, sixthId],
        stacking: { A: false, B: false }, firstServer: { team: 'A', playerId: johnId },
        rightStart: { A: johnId, B: kaiId },
        startedAt: Date.now() - 15 * 60_000,
      },
    })
    check('M3 is a doubles match with rightStart naming the player about to be removed -> 201',
      m3Create.status === 201 && m3Create.body.match?.rightStart?.A === johnId, JSON.stringify(m3Create.body).slice(0, 150))

    const m3Events = [
      ...Array.from({ length: 11 }, (_, i) => rally(i, johnId)),
      { id: uuid(), seq: 11, type: 'thirdShot', at: Date.now(), playerId: johnId, shotType: 'drive', success: true },
      rally(12, kaiId),
    ]
    const m3Log = await request(`/matches/${m3Id}/log`, { method: 'PUT', bearer: umpAToken, body: { deviceId: DEVICE, events: m3Events } })
    check('M3 finishes, with a thirdShot event also naming John',
      m3Log.body.match?.status === 'completed' && (m3Log.body.match?.events ?? []).some((e) => e.type === 'thirdShot' && e.playerId === johnId),
      JSON.stringify(m3Log.body).slice(0, 150))

    const session2End = await request(`/sessions/${session2Id}/end`, { method: 'POST', bearer: umpAToken, body: {} })
    check('umpire A ends the second session too -> 200', session2End.status === 200, String(session2End.status))

    const wrongName = await request('/admin/overview/merge', {
      method: 'POST', bearer: fOwnerToken, body: { keepId: jonId, removeId: johnId, confirmName: 'nope' },
    })
    check('merge needs the removed name typed -> 400', wrongName.status === 400, JSON.stringify(wrongName.body))
    const merged = await request('/admin/overview/merge', {
      method: 'POST', bearer: fOwnerToken, body: { keepId: jonId, removeId: johnId, confirmName: johnName },
    })
    check('merge -> 200 with one match moved', merged.status === 200 && merged.body.movedMatches === 1, JSON.stringify(merged.body))

    const m3 = await request(`/matches/${m3Id}`, { bearer: umpAToken })
    check('M3 now names Jon, not John', m3.body.match?.teamA?.includes(jonId) && !m3.body.match?.teamA?.includes(johnId),
      JSON.stringify(m3.body.match?.teamA))
    check("M3's rightStart now names Jon, not John",
      m3.body.match?.rightStart?.A === jonId, JSON.stringify(m3.body.match?.rightStart))
    const m3StillNamingJohn = (m3.body.match?.events ?? []).flatMap((e) => [e.actingPlayerId, e.playerId]).filter((id) => id === johnId)
    check("none of M3's events -- rally or thirdShot -- still name John, on either payload key",
      m3StillNamingJohn.length === 0, JSON.stringify(m3StillNamingJohn))
    check("M3's rallies now name Jon", (m3.body.match?.events ?? []).filter((e) => e.actingPlayerId === jonId).length > 0)
    check("M3's thirdShot event now names Jon, not John",
      (m3.body.match?.events ?? []).some((e) => e.type === 'thirdShot' && e.playerId === jonId),
      JSON.stringify((m3.body.match?.events ?? []).filter((e) => e.type === 'thirdShot')))

    const newMatchNamingRemoved = await request('/matches', {
      method: 'POST', bearer: umpAToken,
      body: {
        id: uuid(), sessionId: session2Id, teamA: [johnId, reyId], teamB: [kaiId, sixthId],
        stacking: { A: false, B: false }, firstServer: { team: 'A', playerId: reyId },
        startedAt: Date.now(),
      },
    })
    check('a NEW match naming the merged-away player -> 409',
      newMatchNamingRemoved.status === 409 && newMatchNamingRemoved.body.error === 'One of those players no longer exists',
      JSON.stringify(newMatchNamingRemoved.body))

    const sharedRefusal = await request('/admin/overview/merge', {
      method: 'POST', bearer: fOwnerToken, body: { keepId: jonId, removeId: reyId, confirmName: reyName },
    })
    check('players who shared a match are refused -> 409', sharedRefusal.status === 409, JSON.stringify(sharedRefusal.body))
    const notSame = await request('/admin/overview/not-same-person', { method: 'POST', bearer: fOwnerToken, body: { playerIds: [jonId, miaId] } })
    check('not the same person -> 200', notSame.status === 200, JSON.stringify(notSame.body))

    // --- Step 5: cleanup -- close the throwaway players and umpires,
    // switch off the throwaway admins, and rename the facilities so the
    // list stays readable. Never touch the shared smoke umpire or the
    // owner. ---
    const closeJon = await request(`/admin/players/${jonId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: jonName } })
    check('closing Jon (the merge survivor) -> 200', closeJon.status === 200 && closeJon.body.player?.status === 'closed', JSON.stringify(closeJon.body).slice(0, 80))
    const closeMia = await request(`/admin/players/${miaId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: miaName } })
    check('closing Mia -> 200', closeMia.status === 200 && closeMia.body.player?.status === 'closed', JSON.stringify(closeMia.body).slice(0, 80))
    const closeRey = await request(`/admin/players/${reyId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: reyName } })
    check('closing Rey -> 200', closeRey.status === 200 && closeRey.body.player?.status === 'closed', JSON.stringify(closeRey.body).slice(0, 80))
    const closeKai = await request(`/admin/players/${kaiId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: kaiName } })
    check('closing Kai -> 200', closeKai.status === 200 && closeKai.body.player?.status === 'closed', JSON.stringify(closeKai.body).slice(0, 80))
    const closeSixth = await request(`/admin/players/${sixthId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: sixthName } })
    check('closing the sixth player -> 200', closeSixth.status === 200 && closeSixth.body.player?.status === 'closed', JSON.stringify(closeSixth.body).slice(0, 80))
    const closePlB1 = await request(`/admin/players/${plB1Id}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: plB1Name } })
    check("closing umpire B's first player -> 200", closePlB1.status === 200 && closePlB1.body.player?.status === 'closed', JSON.stringify(closePlB1.body).slice(0, 80))
    const closePlB2 = await request(`/admin/players/${plB2Id}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: plB2Name } })
    check("closing umpire B's second player -> 200", closePlB2.status === 200 && closePlB2.body.player?.status === 'closed', JSON.stringify(closePlB2.body).slice(0, 80))

    const closeUmpA = await request(`/admin/umpires/${umpireAId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: umpAName } })
    check('closing throwaway umpire A -> 200', closeUmpA.status === 200 && closeUmpA.body.umpire?.status === 'closed', JSON.stringify(closeUmpA.body).slice(0, 80))
    const closeUmpB = await request(`/admin/umpires/${umpireBId}/close`, { method: 'POST', bearer: fOwnerToken, body: { reason: 'smoke cleanup', confirmName: umpBName } })
    check('closing throwaway umpire B -> 200', closeUmpB.status === 200 && closeUmpB.body.umpire?.status === 'closed', JSON.stringify(closeUmpB.body).slice(0, 80))

    const offAdminA = await request(`/admin/admins/${adminAId}/switch-off`, { method: 'POST', bearer: fOwnerToken })
    check('switching off throwaway admin A -> 200', offAdminA.status === 200 && offAdminA.body.admin?.active === false, String(offAdminA.status))
    const offAdminB = await request(`/admin/admins/${adminBId}/switch-off`, { method: 'POST', bearer: fOwnerToken })
    check('switching off throwaway admin B -> 200', offAdminB.status === 200 && offAdminB.body.admin?.active === false, String(offAdminB.status))

    const renameA = await request(`/admin/facilities/${facilityAId}`, { method: 'PATCH', bearer: fOwnerToken, body: { name: `Smoke Overview (done) A ${stamp}` } })
    check('renaming facility A for cleanup -> 200', renameA.status === 200, JSON.stringify(renameA.body).slice(0, 80))
    const renameB = await request(`/admin/facilities/${facilityBId}`, { method: 'PATCH', bearer: fOwnerToken, body: { name: `Smoke Overview (done) B ${stamp}` } })
    check('renaming facility B for cleanup -> 200', renameB.status === 200, JSON.stringify(renameB.body).slice(0, 80))
  }

  // ============================================================
  section('tidy — the sessions this run opened')
  // ============================================================
  // Left to itself this suite opens a dozen nights and walks away from
  // them, and every one turns up on the admin Overview as something
  // worth a look. Nothing here is deleted: the matches, the players and
  // the taps all stay exactly where they are.

  const stillOpen = await closeOpenSessions()
  check('every session this run opened is closed again',
    stillOpen.length === 0, stillOpen.join(', '))

  // ============================================================
  section('tidy — remove what this run made (staging only)')
  // ============================================================
  // Staging turns this route on with SMOKE_TIDY=on; production does not
  // have it. Without it, every run left its umpires, admins, places,
  // players and nights behind, and staging filled up with them.
  if (/staging|localhost|127\.0\.0\.1/.test(API) && process.env.SMOKE_INTERNAL_KEY) {
    const tidy = await fetch(`${API}/internal/smoke-tidy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.SMOKE_INTERNAL_KEY },
      body: JSON.stringify({
        umpireIds: [...made.umpireIds],
        adminIds: [...made.adminIds],
        facilityIds: [...made.facilityIds],
        playerIds: [...made.playerIds, ...selfRegistered],
        inviteCodes: [...made.inviteCodes],
        nightsOf: smokeUmpireId,
        activityOf: smokeOwnerId,
      }),
    })
    const removed = await tidy.json().catch(() => ({}))
    check('what this run made is removed again -> 200', tidy.status === 200,
      tidy.status === 404 ? 'SMOKE_TIDY is not on for this server' : JSON.stringify(removed).slice(0, 120))
    if (tidy.status === 200) console.log(`  ...  removed ${JSON.stringify(removed.removed)}`)
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
