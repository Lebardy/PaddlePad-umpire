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

import { randomBytes } from 'node:crypto'
import { RALLY_ENDINGS, rallyEndingColumn } from '../src/rally-endings.js'
import { NOT_LEFT_OPEN_MESSAGE, SESSION_REASON_MESSAGE } from '../src/overview-rules.js'
import { manilaDayStart, openPlayWhen } from '../src/visit-rules.js'

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

/** Asks staging to remove what this run made; null when this server is not staging. */
function tidyStaging() {
  if (!(/staging|localhost|127\.0\.0\.1/.test(API) && process.env.SMOKE_INTERNAL_KEY)) return null
  return fetch(`${API}/internal/smoke-tidy`, {
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

  section('a cancel from a device that is not scoring the match is refused')
  // otherDevice holds liveMatchId now, with a fresh lease.
  const cancelByOther = await call(`/matches/${liveMatchId}`, { method: 'DELETE', body: { deviceId: DEVICE } })
  check('another device cancelling a held match -> 409 with heldBy',
    cancelByOther.status === 409 && Boolean(cancelByOther.body.heldBy?.umpireName), JSON.stringify(cancelByOther.body))
  const heldSession = uuid()
  const heldMatch = uuid()
  await call('/sessions', { method: 'POST', body: { id: heldSession, name: `Held Night ${stamp}` } })
  await call('/matches', {
    method: 'POST',
    body: {
      id: heldMatch, sessionId: heldSession, teamA, teamB,
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: teamA[0] },
      startedAt: Date.now(),
    },
  })
  await call(`/matches/${heldMatch}/log`, { method: 'PUT', body: { deviceId: otherDevice, events: [rally(0, teamA[0])] } })
  const sessionByOther = await call(`/sessions/${heldSession}`, { method: 'DELETE', body: { deviceId: DEVICE } })
  check('another device deleting a session with a held match -> 409 with heldBy',
    sessionByOther.status === 409 && Boolean(sessionByOther.body.heldBy?.umpireName), JSON.stringify(sessionByOther.body))
  const sessionByHolder = await call(`/sessions/${heldSession}`, { method: 'DELETE', body: { deviceId: otherDevice } })
  check('the device holding the match can delete the session -> 204', sessionByHolder.status === 204, String(sessionByHolder.status))
  const [ownMatch, oldCopyMatch] = [uuid(), uuid()]
  for (const id of [ownMatch, oldCopyMatch]) {
    await call('/matches', {
      method: 'POST',
      body: {
        id, sessionId, teamA, teamB,
        stacking: { A: false, B: false },
        firstServer: { team: 'A', playerId: teamA[0] },
        startedAt: Date.now(),
      },
    })
    await call(`/matches/${id}/log`, { method: 'PUT', body: { deviceId: otherDevice, events: [rally(0, teamA[0])] } })
  }
  const cancelByHolder = await call(`/matches/${ownMatch}`, { method: 'DELETE', body: { deviceId: otherDevice } })
  check('the device scoring the match can cancel it -> 204', cancelByHolder.status === 204, String(cancelByHolder.status))
  const oldCopy = await call(`/matches/${oldCopyMatch}`, { method: 'DELETE' })
  check('a cancel with no deviceId (older app copy) still works -> 204', oldCopy.status === 204, String(oldCopy.status))

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
      body: { ratings: [{ playerId: uuid() }] },
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
          skillGroup: 'Higher-Performance',
          playstyleCluster: 1,
          playstyleArchetype: 'Patient Net Controller',
          evidence: { aggression_mean: 0.61 },
          matchCount: 9,
        }],
      },
    })
    check('a completed run is written -> 201', good.status === 201, String(good.status))

    // The whole point of storing snapshots: a result is meaningless
    // without the pool and the moment it was computed against.
    check('the run records the pool it was computed against',
      good.body.run?.id && good.body.run?.computed_at, JSON.stringify(good.body.run))

    const dupe = await internal('/internal/ratings', {
      method: 'POST',
      body: { ratings: [
        { playerId: playerA },
        { playerId: playerA },
      ] },
    })
    check('a duplicate player in one snapshot is refused -> 400', dupe.status === 400,
      String(dupe.status))

    // And the player-facing end of the seam: the result reaches the
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
      check('the rating carries the group and the playstyle',
        me.rating?.skillGroup === 'Higher-Performance' &&
        me.rating?.playstyleArchetype === 'Patient Net Controller',
        JSON.stringify(me.rating))
      check('the rating carries the pool it was measured against',
        me.rating?.poolSize === 1 && !!me.rating?.computedAt,
        JSON.stringify(me.rating))
      check('the rating carries those fields and nothing else',
        JSON.stringify(Object.keys(me.rating ?? {}).sort()) === JSON.stringify(
          ['computedAt', 'evidence', 'fromMatches', 'playstyleArchetype', 'poolSize', 'skillGroup', 'state']),
        JSON.stringify(Object.keys(me.rating ?? {}).sort()))

      // A later run replaces what the player sees. Sent with a larger
      // pool, and with a field the API does not read, which must be
      // ignored rather than refused.
      const later = await internal('/internal/ratings', {
        method: 'POST',
        body: {
          playerCount: 9,
          ratings: [{ playerId: playerA, playstyleArchetype: 'Steady Dropper', notRead: 64.2 }],
        },
      })
      check('a rating with a field the API does not read is still written -> 201',
        later.status === 201, String(later.status))
      const moved = await fetch(`${API}/player/me`, {
        headers: { Authorization: `Bearer ${claimBody.token}` },
      }).then((r) => r.json())
      check('the player sees the latest run',
        moved.rating?.playstyleArchetype === 'Steady Dropper' && moved.rating?.poolSize === 9,
        JSON.stringify(moved.rating))
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
    check('/player/standing carries a level key (null for a player outside the latest levelled run)',
      'level' in (standingWithRally.body.standing ?? {}) && standingWithRally.body.standing.level === null,
      JSON.stringify(standingWithRally.body.standing?.level))
    const listWithRally = await asPlayer('/player/matches', { bearer: linked.body.token })
    const listed = listWithRally.body.matches ?? []
    check('/player/matches carries a rally section with only the agreed fields',
      listed.length > 0 && listed.every((m) => m.rally === null || (
        JSON.stringify(Object.keys(m.rally).sort()) === JSON.stringify(['change', 'endings', 'expectation', 'result', 'untagged']) &&
        m.rally.endings.every((e) => JSON.stringify(Object.keys(e).sort()) === JSON.stringify(['ending', 'outcome', 'points', 'rallies'])))),
      JSON.stringify(listed[0]?.rally ?? null).slice(0, 160))
    check('a match in the list carries its rating only inside the rally section',
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

    // --- rivals: two players who split two matches as opponents ---
    const rivalsMe = await register({
      name: `Smoke Rivals Me ${stamp3}`, username: `smk_rvm_${stamp3}`.slice(0, 20), password: PASSWORD,
    })
    if (rivalsMe.body.player?.id) selfRegistered.push(rivalsMe.body.player.id)
    const meId = rivalsMe.body.player?.id
    const meToken = rivalsMe.body.token
    const foeName = `Smoke Rivals Foe ${stamp3}`
    const foeId = await newPlayer(foeName)
    const rivalsSid = await newSession(`Smoke Rivals Night ${stamp3}`, [meId, foeId])
    // playMatch has team A's first player win, so swapping the sides
    // makes it one win each: a close record.
    const r1 = await playMatch(rivalsSid, [meId], [foeId])
    const r2 = await playMatch(rivalsSid, [foeId], [meId])
    check('two finished matches between the pair',
      r1.status === 'completed' && r2.status === 'completed', `${r1.status}/${r2.status}`)

    const rivalsRes = await asPlayer('/player/rivals', { bearer: meToken })
    check('GET /player/rivals -> 200', rivalsRes.status === 200, String(rivalsRes.status))
    check('it answers rivals, nearRating and partners and nothing else',
      JSON.stringify(Object.keys(rivalsRes.body).sort()) === '["nearRating","partners","rivals"]',
      JSON.stringify(Object.keys(rivalsRes.body)))
    const rivalsText = JSON.stringify(rivalsRes.body)
    check('no id and no rating-sized number in it',
      !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(rivalsText) &&
        // JSON.parse's reviver sees real numbers only, not the digits in a name.
        (() => { let big = false; JSON.parse(rivalsText, (_k, v) => { if (typeof v === 'number' && v > 1000) big = true; return v }); return !big })(),
      rivalsText.slice(0, 160))
    const foe = (rivalsRes.body.rivals ?? []).find((r) => r.name === foeName)
    check('the opponent they split two matches with is a rival, by name, from their matches',
      foe?.kind === 'matches' && foe.won === 1 && foe.lost === 1, JSON.stringify(rivalsRes.body.rivals))

    // --- the near-rating-name switch ---
    const nrn = (body) => asPlayer('/player/me/near-rating-name', { method: 'PUT', bearer: meToken, body })
    const nrnOn = await nrn({ on: true })
    check('turning the switch on -> 200 and says so',
      nrnOn.status === 200 && nrnOn.body.player?.nearRatingName === true, JSON.stringify(nrnOn.body).slice(0, 120))
    check('a switch that is not true or false -> 400', (await nrn({ on: 'yes' })).status === 400)
    check('the profile carries it',
      (await asPlayer('/player/me', { bearer: meToken })).body.player?.nearRatingName === true)
    // The app reads the switch from the launch check, not /player/me.
    check('the launch check carries it too',
      (await asPlayer('/auth/player/me', { bearer: meToken })).body.player?.nearRatingName === true)
    check('and it goes back off', (await nrn({ on: false })).body.player?.nearRatingName === false)
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
    check('finishing setup signs the admin in -> 200', setUp.status === 200 && setUp.body.admin?.role === 'manager',
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

  section('match video')
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    const vOwner = (await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })).body.token
    const vMe = await request('/auth/me', { bearer: token })
    const vFacilities = (await request('/admin/facilities', { bearer: vOwner })).body.facilities ?? []
    const vFacility = vFacilities.find((f) => f.name === vMe.body.umpire?.facilityName)
    const vOther = vFacilities.find((f) => f.id !== vFacility?.id)
    check("the smoke umpire's facility is found, and another one", Boolean(vFacility && vOther), JSON.stringify([vFacility?.name, vOther?.name]))
    const vFilmedBefore = vFacility?.filmsMatches === true
    const vStatusOff = await request('/video/camera/status', { bearer: token })
    if (vStatusOff.status === 404 && vStatusOff.body.error === 'Video is not set up here') {
      console.log('  skip (this server has no video bucket)')
    } else {
      const device = `smoke-camera-${Date.now()}`
      const vSession = crypto.randomUUID()
      const vOtherBefore = vOther.filmsMatches === true
      let vStrangerNight = null   // [the stranger's token, their night], ended in the finally
      let vManager = null         // [token, id] of a manager at vFacility; paused in the finally
      let vManagerOther = null    // the same, at vOther
      // Whatever happens below, the facility goes back to how it was and the night is closed.
      try {
        const beat = (body, bearer = token) => request('/video/camera/beat', { method: 'POST', bearer, body: { deviceId: device, ...body } })

        check('no token on a video route -> 401', (await request('/video/camera/status')).status === 401)
        await request(`/admin/facilities/${vFacility.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: false } })
        check('where the facility does not film, sign-in offers no camera',
          (await request('/auth/me', { bearer: token })).body.umpire?.camera === false)
        await request(`/admin/facilities/${vFacility.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: true } })
        check('where it films, sign-in offers the camera',
          (await request('/auth/me', { bearer: token })).body.umpire?.camera === true)

        // A night of its own, so nothing else in this run is disturbed.
        const vPlayers = []
        for (const name of ['Smoke Video One', 'Smoke Video Two']) {
          vPlayers.push((await request('/players', { method: 'POST', bearer: token, body: { name: `${name} ${Date.now()}` } })).body.player.id)
        }
        await request('/sessions', { method: 'POST', bearer: token, body: { id: vSession, name: `Smoke video ${Date.now()}` } })
        await request(`/sessions/${vSession}/players`, { method: 'PUT', bearer: token, body: { playerIds: vPlayers } })

        const quiet = await beat({ state: 'ready' })
        // Earlier sections leave matches in progress for this umpire, so the beat may name one of those.
        check('a beat is answered -> 200, with the time',
          quiet.status === 200 && Math.abs(quiet.body.now - Date.now()) < 60_000, JSON.stringify(quiet.body).slice(0, 100))
        check('the tablet then sees a ready camera', (await request('/video/camera/status', { bearer: token })).body.camera === 'ready')

        const vMatch = crypto.randomUUID()
        const startedAt = Date.now() - 60_000
        const started = await request('/matches', {
          method: 'POST', bearer: token,
          body: { id: vMatch, sessionId: vSession, teamA: [vPlayers[0]], teamB: [vPlayers[1]], stacking: { A: false, B: false },
            firstServer: { team: 'A', playerId: vPlayers[0] }, pointTarget: 11, startedAt },
        })
        check('a match is started -> 201', started.status === 201, JSON.stringify(started.body).slice(0, 100))
        const named = await beat({ state: 'ready' })
        check('the next beat names it, with who is playing',
          named.body.match?.id === vMatch && named.body.match?.teamA?.length === 1 && /^Smoke Video One/.test(named.body.match.teamA[0]),
          JSON.stringify(named.body.match))
        const at0 = named.body.match?.score
        check('the named match carries its score: 0-0, A serving, no server number in singles',
          at0?.a === 0 && at0?.b === 0 && at0?.serving === 'A' && at0?.server === null, JSON.stringify(at0))

        const noDevice = await request(`/video/matches/${vMatch}/claim`, { method: 'POST', bearer: token, body: {} })
        check('a claim with no device -> 400', noDevice.status === 400, String(noDevice.status))
        const claim = await request(`/video/matches/${vMatch}/claim`, { method: 'POST', bearer: token, body: { deviceId: device } })
        check('the camera claims the match -> 201', claim.status === 201, JSON.stringify(claim.body))
        check('claiming it again from the same phone is fine -> 201',
          (await request(`/video/matches/${vMatch}/claim`, { method: 'POST', bearer: token, body: { deviceId: device } })).status === 201)
        check('another phone cannot -> 409',
          (await request(`/video/matches/${vMatch}/claim`, { method: 'POST', bearer: token, body: { deviceId: 'another-phone' } })).status === 409)
        await beat({ state: 'filming', matchId: vMatch })
        check('the tablet sees it filming', (await request('/video/camera/status', { bearer: token })).body.camera === 'filming')
        check('another phone on the same account is not told to film this match',
          (await request('/video/camera/beat', { method: 'POST', bearer: token, body: { deviceId: 'another-phone', state: 'ready' } })).body.match?.id !== vMatch)
        check('while it is being filmed there is nothing to watch yet',
          (await request(`/video/matches/${vMatch}`, { bearer: token })).body.video?.state === 'filming')

        // Three rallies, stamped by a tablet whose clock is 5 s behind the server.
        const lag = 5000
        const tapped = [20_000, 35_000, 50_000].map((ms) => startedAt + ms)
        // The receiving side wins the first rally (a side-out, no point), so two of the three rallies are points.
        const events = tapped.map((at, seq) => ({
          id: crypto.randomUUID(), seq, type: 'rally', at, actingPlayerId: vPlayers[1], outcome: 'winner', zone: 'baseline',
        }))
        const logged = await request(`/matches/${vMatch}/log`, {
          method: 'PUT', bearer: token,
          body: { deviceId: 'smoke-tablet', events, sentAt: Date.now() - lag, endedEarly: true, endedEarlyAt: Date.now() - lag },
        })
        check('the tablet saves three rallies with its clock and stops the match -> 200',
          logged.status === 200 && logged.body.match?.status === 'completed', JSON.stringify(logged.body).slice(0, 120))

        const meta = { deviceId: device, width: 1920, height: 1080, durationMs: 120_000, firstFrameAt: startedAt + lag + 4000, repacked: true }
        check('a video over 2 GB -> 413',
          (await request(`/video/matches/${vMatch}/upload`, { method: 'POST', bearer: token, body: { ...meta, bytes: 2 * 1024 ** 3 + 1 } })).status === 413)
        check('a video with no size -> 400',
          (await request(`/video/matches/${vMatch}/upload`, { method: 'POST', bearer: token, body: { ...meta, bytes: 0 } })).status === 400)
        check('another phone cannot send for it -> 409',
          (await request(`/video/matches/${vMatch}/upload`, { method: 'POST', bearer: token, body: { ...meta, deviceId: 'another-phone', bytes: 1024 } })).status === 409)
        const up = await request(`/video/matches/${vMatch}/upload`, { method: 'POST', bearer: token, body: { ...meta, bytes: 1024 } })
        check('the camera asks to send 1024 bytes -> 200 with a form for the bucket',
          up.status === 200 && /^https:\/\//.test(up.body.form?.url ?? '') && up.body.form?.fields?.['Content-Type'] === 'video/mp4', String(up.status))
        check('saying done before sending -> 409',
          (await request(`/video/matches/${vMatch}/done`, { method: 'POST', bearer: token, body: { deviceId: device } })).status === 409)
        const clip = new Uint8Array(1024).map((_, i) => i % 251)
        const form = new FormData()
        for (const [name, value] of Object.entries(up.body.form?.fields ?? {})) form.append(name, value)
        form.append('file', new Blob([clip], { type: 'video/mp4' }), 'clip.mp4')
        const stored = await fetch(up.body.form.url, { method: 'POST', body: form })
        check('the bucket takes the file straight from here', stored.status >= 200 && stored.status < 300, String(stored.status))
        const done = await request(`/video/matches/${vMatch}/done`, { method: 'POST', bearer: token, body: { deviceId: device } })
        check('done -> 200', done.status === 200, JSON.stringify(done.body))
        check('done again is fine -> 200',
          (await request(`/video/matches/${vMatch}/done`, { method: 'POST', bearer: token, body: { deviceId: device } })).status === 200)

        const watch = await request(`/video/matches/${vMatch}`, { bearer: token })
        const v = watch.body.video
        check('the umpire can now watch: ready, lined up by the clock, with its size',
          v?.state === 'ready' && v.linedUpBy === 'clock' && v.repacked === true && v.durationMs === 120_000 && v.width === 1920 && v.height === 1080,
          JSON.stringify({ ...v, url: v?.url ? '[link]' : null }).slice(0, 200))
        // First picture 4 s after the start. Rally ends at 20, 35, 50 s -> they start at 0 (before the video), 16 and 31.
        // Within a second: the offset the server worked out includes however long the save took to arrive.
        const secondsSeen = v?.rallies?.map((r) => r.second) ?? []
        check('each rally has its second, in play order, with the tablet clock corrected',
          secondsSeen.length === 3 && typeof secondsSeen[0] === 'number' && secondsSeen[0] <= 1 && Math.abs(secondsSeen[1] - 16) <= 1 && Math.abs(secondsSeen[2] - 31) <= 1
            && v.rallies.every((r, i) => r.id === events[i].id),
          JSON.stringify(secondsSeen))
        const played = await fetch(v.url)
        check('the link plays the file from the bucket', played.status === 200 && (await played.arrayBuffer()).byteLength === 1024, String(played.status))

        const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 1
        check('a new video has no highlights', Array.isArray(v?.highlights) && v.highlights.length === 0, JSON.stringify(v?.highlights))
        const starred = await request(`/video/matches/${vMatch}/highlights`, { method: 'PUT', bearer: token, body: { rallyIds: [events[2].id, events[1].id] } })
        const hl = starred.body.video?.highlights ?? []
        check('the umpire stars two rallies -> 200, in play order, each with its clip',
          starred.status === 200 && hl.length === 2 && hl[0].id === events[1].id && near(hl[0].start, 16) && near(hl[0].end, 32)
            && hl[1].id === events[2].id && near(hl[1].start, 31) && near(hl[1].end, 47),
          JSON.stringify(hl))
        check('six rallies -> 400',
          (await request(`/video/matches/${vMatch}/highlights`, { method: 'PUT', bearer: token, body: { rallyIds: Array.from({ length: 6 }, () => crypto.randomUUID()) } })).status === 400)
        check('a rally of another match -> 400',
          (await request(`/video/matches/${vMatch}/highlights`, { method: 'PUT', bearer: token, body: { rallyIds: [crypto.randomUUID()] } })).status === 400)
        check('the same rally twice -> 400',
          (await request(`/video/matches/${vMatch}/highlights`, { method: 'PUT', bearer: token, body: { rallyIds: [events[1].id, events[1].id] } })).status === 400)
        check('the admin match page carries them, each on its point or none',
          (await request(`/admin/matches/${vMatch}`, { bearer: vOwner })).body.match?.video?.highlights?.length === 2)

        // Rows the admin site lists can link to the match page and show a camera.
        const listedRow = (rows) => (rows ?? []).find((m) => m.id === vMatch)
        const vPlayerRow = listedRow((await request(`/admin/players/${vPlayers[0]}`, { bearer: vOwner })).body.player?.matches)
        check("the player's page row says it has a video, and where",
          vPlayerRow?.hasVideo === true && vPlayerRow?.facilityId === vFacility.id, JSON.stringify([vPlayerRow?.hasVideo, vPlayerRow?.facilityId]))
        const vUmpireRow = listedRow((await request(`/admin/umpires/${vMe.body.umpire?.id}`, { bearer: vOwner })).body.umpire?.matches)
        check("the umpire's page row says it has a video, and where",
          vUmpireRow?.hasVideo === true && vUmpireRow?.facilityId === vFacility.id, JSON.stringify([vUmpireRow?.hasVideo, vUmpireRow?.facilityId]))
        const vTotalsAll = (await request('/admin/overview', { bearer: vOwner })).body.totals?.videos
        check('the Overview counts the stored videos and their size',
          vTotalsAll?.count >= 1 && vTotalsAll?.bytes >= 1024, JSON.stringify(vTotalsAll))
        const vTotalsOther = (await request(`/admin/overview?facilityId=${vOther.id}`, { bearer: vOwner })).body.totals?.videos
        check('scoped to another facility, the count leaves this video out',
          typeof vTotalsOther?.count === 'number' && vTotalsOther.count < vTotalsAll?.count, JSON.stringify([vTotalsOther, vTotalsAll]))
        const vTotalsHere = (await request(`/admin/overview?facilityId=${vFacility.id}`, { bearer: vOwner })).body.totals?.videos
        check('scoped to the facility that filmed it, the video is counted',
          vTotalsHere?.count >= 1 && vTotalsHere?.bytes >= 1024, JSON.stringify(vTotalsHere))

        // The admin site's match page. A manager is made the way the admin sections make one.
        const makeManager = async (facilityId, label) => {
          const added = await request('/admin/admins', {
            method: 'POST', bearer: vOwner, body: { name: `Smoke Video Manager ${label}`, email: `smoke.video.${label}.${Date.now()}@example.com`, facilityId },
          })
          const secret = (added.body.setupLink?.url ?? '').split('/setup/')[1]
          const setup = await request(`/admin/auth/setup/${secret}`, { method: 'POST', body: { password: `smoke-${crypto.randomUUID()}` } })
          return [setup.body.token, added.body.admin?.id]
        }
        vManager = await makeManager(vFacility.id, 'same')
        vManagerOther = await makeManager(vOther.id, 'other')
        const pageRead = await request(`/admin/matches/${vMatch}`, { bearer: vOwner })
        const pm = pageRead.body.match
        check('the owner reads the match page -> 200', pageRead.status === 200, String(pageRead.status))
        check('it has the score, who played, where and the umpire',
          pm?.scoreA + pm?.scoreB === pm?.points?.length && pm.teamA?.[0]?.id === vPlayers[0] && pm.facilityId === vFacility.id
            && typeof pm.umpireName === 'string' && pm.umpireName !== '' && pm.status === 'completed',
          JSON.stringify({ a: pm?.scoreA, b: pm?.scoreB, n: pm?.points?.length, umpire: pm?.umpireName, status: pm?.status }))
        const lastPoint = pm?.points?.[pm.points.length - 1]
        check('every point has its score, its side and how it ended',
          pm?.points?.length > 0 && pm.points.every((p) => Number.isInteger(p.a) && Number.isInteger(p.b) && ['A', 'B'].includes(p.team) && p.label)
            && lastPoint.a === pm.scoreA && lastPoint.b === pm.scoreB,
          JSON.stringify(pm?.points))
        const pagePlayed = await fetch(pm?.video?.url ?? 'http://localhost:1/none').catch(() => ({ status: 0 }))
        check("the page's link plays the file", pagePlayed.status === 200, String(pagePlayed.status))
        check('the owner may remove the video', pm?.mayRemoveVideo === true)
        check('no token -> 401', (await request(`/admin/matches/${vMatch}`)).status === 401)
        check('a made-up id -> 404', (await request(`/admin/matches/${crypto.randomUUID()}`, { bearer: vOwner })).status === 404)
        check('not a uuid -> 404', (await request('/admin/matches/not-a-uuid', { bearer: vOwner })).status === 404)
        const mgrRead = await request(`/admin/matches/${vMatch}`, { bearer: vManager[0] })
        check('a manager of that facility reads it -> 200, but may not remove the video',
          mgrRead.status === 200 && mgrRead.body.match?.mayRemoveVideo === false, `${mgrRead.status} ${mgrRead.body.match?.mayRemoveVideo}`)
        check('a manager of another facility -> 404', (await request(`/admin/matches/${vMatch}`, { bearer: vManagerOther[0] })).status === 404)
        const vTotalsOtherManager = (await request('/admin/overview', { bearer: vManagerOther[0] })).body.totals?.videos
        check("the other facility's manager sees the same video count as the owner scoped to it",
          typeof vTotalsOther?.count === 'number' && vTotalsOtherManager?.count === vTotalsOther.count, JSON.stringify([vTotalsOtherManager, vTotalsOther]))
        const vTotalsManager = (await request('/admin/overview', { bearer: vManager[0] })).body.totals?.videos
        check("that facility's manager sees its video counted",
          vTotalsManager?.count >= 1 && vTotalsManager.count === vTotalsHere?.count, JSON.stringify([vTotalsManager, vTotalsHere]))

        // A player who was in the match watches it.
        const vCode = await request(`/players/${vPlayers[0]}/claim-code`, { bearer: token })
        const vPlayerToken = (await asPlayer('/auth/player/claim', { method: 'POST', body: { code: vCode.body.claimCode } })).body.token
        const vGame = await asPlayer(`/player/matches/${vMatch}/game`, { bearer: vPlayerToken })
        const pv = vGame.body.video
        check("the player's match read carries the video: a link, its length and its picture size",
          vGame.status === 200 && /^https:\/\//.test(pv?.url ?? '') && pv.durationMs === 120_000 && pv.width === 1920 && pv.height === 1080 && vGame.body.video?.mayRemove === false,
          JSON.stringify({ ...pv, url: pv?.url ? '[link]' : null }).slice(0, 160))
        // The first rally was a side-out, so the two points are the second and third rallies, not the first two.
        check('one second for each point, the same as the rallies they were',
          vGame.body.points?.length === 2 && pv?.seconds?.length === 2
            && pv.seconds[0] === v.rallies[1].second && pv.seconds[1] === v.rallies[2].second
            && pv.seconds[0] !== v.rallies[0].second,
          JSON.stringify(pv?.seconds))
        check('and one video second for each point, the same as the player sees',
          pm?.video?.seconds?.length > 0 && pm.video.seconds.length === pm.points?.length && JSON.stringify(pm.video.seconds) === JSON.stringify(pv?.seconds),
          JSON.stringify([pm?.video?.seconds, pv?.seconds]))
        const pPlayed = await fetch(pv.url)
        check("the player's link plays the file", pPlayed.status === 200 && (await pPlayed.arrayBuffer()).byteLength === 1024, String(pPlayed.status))
        const vList = await asPlayer('/player/matches', { bearer: vPlayerToken })
        check("the player's match list marks it as having a video",
          (vList.body.matches ?? []).find((m) => m.id === vMatch)?.hasVideo === true, JSON.stringify((vList.body.matches ?? []).map((m) => m.hasVideo)))
        const vPlaces = await asPlayer('/player/facilities', { bearer: vPlayerToken })
        check('Places to play says which facility films',
          (vPlaces.body.facilities ?? []).find((f) => f.id === vFacility.id)?.filmsMatches === true
            && (vPlaces.body.facilities ?? []).every((f) => typeof f.filmsMatches === 'boolean'),
          JSON.stringify((vPlaces.body.facilities ?? []).map((f) => f.filmsMatches)))
        check("and so does the facility's page",
          (await asPlayer(`/player/facilities/${vFacility.id}`, { bearer: vPlayerToken })).body.facility?.filmsMatches === true)
        const vOutsider = (await request('/players', { method: 'POST', bearer: token, body: { name: `Smoke Video Outsider ${Date.now()}` } })).body.player.id
        const vOutsiderToken = (await asPlayer('/auth/player/claim', {
          method: 'POST', body: { code: (await request(`/players/${vOutsider}/claim-code`, { bearer: token })).body.claimCode },
        })).body.token
        check('a player who was not in the match cannot read it -> 404',
          (await asPlayer(`/player/matches/${vMatch}/game`, { bearer: vOutsiderToken })).status === 404)

        const cleared = await request(`/video/matches/${vMatch}/highlights`, { method: 'PUT', bearer: token, body: { rallyIds: [] } })
        check('un-starring everything -> 200 and none left', cleared.status === 200 && cleared.body.video?.highlights?.length === 0, String(cleared.status))

        const vStranger = await request('/admin/invites', { method: 'POST', bearer: vOwner, body: { note: 'smoke video', facilityId: vOther.id } })
        const strangerIn = await request('/auth/register', {
          method: 'POST', body: { email: `smoke.video.${Date.now()}@example.com`, name: 'Smoke Video Stranger', password: 'smoke-video-pass-1', invite: vStranger.body.invite?.code },
        })
        check("an umpire from another facility is made", strangerIn.status === 201, String(strangerIn.status))
        check("and cannot watch this match's video -> 404",
          (await request(`/video/matches/${vMatch}`, { bearer: strangerIn.body.token })).status === 404)
        check('nor remove it -> 404',
          (await request(`/video/matches/${vMatch}`, { method: 'DELETE', bearer: strangerIn.body.token })).status === 404)
        check('nor claim it -> 404',
          (await request(`/video/matches/${vMatch}/claim`, { method: 'POST', bearer: strangerIn.body.token, body: { deviceId: 'x' } })).status === 404)

        // The stranger has no matches of their own, so a beat as them sees only what is made here.
        await request(`/admin/facilities/${vOther.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: true } })
        const sBearer = strangerIn.body.token
        const sPlayers = []
        for (const name of ['Smoke Video Three', 'Smoke Video Four']) {
          sPlayers.push((await request('/players', { method: 'POST', bearer: sBearer, body: { name: `${name} ${Date.now()}` } })).body.player.id)
        }
        const sSession = crypto.randomUUID()
        vStrangerNight = [sBearer, sSession]
        await request('/sessions', { method: 'POST', bearer: sBearer, body: { id: sSession, name: `Smoke video left open ${Date.now()}` } })
        await request(`/sessions/${sSession}/players`, { method: 'PUT', bearer: sBearer, body: { playerIds: sPlayers } })
        const sMatch = crypto.randomUUID()
        await request('/matches', {
          method: 'POST', bearer: sBearer,
          body: { id: sMatch, sessionId: sSession, teamA: [sPlayers[0]], teamB: [sPlayers[1]], stacking: { A: false, B: false },
            firstServer: { team: 'A', playerId: sPlayers[0] }, pointTarget: 11, startedAt: Date.now() - 20 * 60_000 },
        })
        const sBeat = () => request('/video/camera/beat', { method: 'POST', bearer: sBearer, body: { deviceId: 'smoke-stranger-phone', state: 'ready' } })
        const leftOpen = await sBeat()
        check('a match left open for 20 minutes does not start a camera', leftOpen.status === 200 && leftOpen.body.match === null, JSON.stringify(leftOpen.body.match))
        const saved = await request(`/matches/${sMatch}/log`, {
          method: 'PUT', bearer: sBearer,
          body: { deviceId: 'smoke-stranger-tablet', events: [{ id: crypto.randomUUID(), seq: 0, type: 'rally', at: Date.now(), actingPlayerId: sPlayers[0], outcome: 'winner', zone: 'baseline' }], sentAt: Date.now() },
        })
        check('the same match, once it is being scored, does -> 200', saved.status === 200, JSON.stringify(saved.body).slice(0, 100))
        const sNamed = (await sBeat()).body.match
        check('and the next beat names it, with the score following the logged rally',
          sNamed?.id === sMatch && sNamed.score?.a === 1 && sNamed.score?.b === 0 && sNamed.score?.serving === 'A', JSON.stringify(sNamed?.score))

        check('fix timing with no second -> 400',
          (await request(`/video/matches/${vMatch}/line-up`, { method: 'POST', bearer: token, body: { eventId: events[1].id, second: null } })).status === 400)
        check('fix timing with a rally that is not in the match -> 400',
          (await request(`/video/matches/${vMatch}/line-up`, { method: 'POST', bearer: token, body: { eventId: crypto.randomUUID(), second: 10 } })).status === 400)
        // "The rally that was logged at 35 s ended at video second 40."
        const fixed = await request(`/video/matches/${vMatch}/line-up`, { method: 'POST', bearer: token, body: { eventId: events[1].id, second: 40 } })
        // Exact this time: the tablet's offset is on both sides of the sum and cancels.
        check('fix timing -> 200, lined up by the umpire, and every rally moved with it',
          fixed.status === 200 && fixed.body.video?.linedUpBy === 'umpire' && JSON.stringify(fixed.body.video.rallies.map((r) => r.second)) === '[5,25,40]',
          JSON.stringify(fixed.body.video?.rallies?.map((r) => r.second)))

        const gone = await request(`/video/matches/${vMatch}`, { method: 'DELETE', bearer: token })
        check('the umpire removes the video -> 204', gone.status === 204, String(gone.status))
        check('then there is none', (await request(`/video/matches/${vMatch}`, { bearer: token })).body.video === null)
        check("and the player's page row no longer says it has one",
          listedRow((await request(`/admin/players/${vPlayers[0]}`, { bearer: vOwner })).body.player?.matches)?.hasVideo === false)
        const vGameAfter = await asPlayer(`/player/matches/${vMatch}/game`, { bearer: vPlayerToken })
        check('once removed, the player sees the match with no video',
          vGameAfter.status === 200 && vGameAfter.body.video === null && vGameAfter.body.points?.length === 2, `video is null: ${vGameAfter.body.video === null}`)
        check('and the list no longer marks it',
          ((await asPlayer('/player/matches', { bearer: vPlayerToken })).body.matches ?? []).find((m) => m.id === vMatch)?.hasVideo === false)
        check('and the link no longer plays', (await fetch(v.url)).status === 404)
        check('removing it again is fine -> 204', (await request(`/video/matches/${vMatch}`, { method: 'DELETE', bearer: token })).status === 204)

        // A match cancelled while a video is held takes the video with it.
        const vMatch2 = crypto.randomUUID()
        await request('/matches', {
          method: 'POST', bearer: token,
          body: { id: vMatch2, sessionId: vSession, teamA: [vPlayers[0]], teamB: [vPlayers[1]], stacking: { A: false, B: false },
            firstServer: { team: 'A', playerId: vPlayers[0] }, pointTarget: 11, startedAt: Date.now() },
        })
        const film = async (matchId) => {
          await request(`/video/matches/${matchId}/claim`, { method: 'POST', bearer: token, body: { deviceId: device } })
          const up = await request(`/video/matches/${matchId}/upload`, { method: 'POST', bearer: token, body: { ...meta, firstFrameAt: Date.now(), bytes: 1024 } })
          const form = new FormData()
          for (const [name, value] of Object.entries(up.body.form?.fields ?? {})) form.append(name, value)
          form.append('file', new Blob([clip], { type: 'video/mp4' }), 'clip.mp4')
          await fetch(up.body.form.url, { method: 'POST', body: form })
          await request(`/video/matches/${matchId}/done`, { method: 'POST', bearer: token, body: { deviceId: device } })
          return (await request(`/video/matches/${matchId}`, { bearer: token })).body.video?.url
        }
        const link2 = await film(vMatch2)
        check('a second match has its video', (await fetch(link2)).status === 200)
        check('a manager cannot remove a video -> 403',
          (await request(`/admin/matches/${vMatch2}/video`, { method: 'DELETE', bearer: vManager[0] })).status === 403)
        check('a manager of another facility cannot remove it -> 403, before any lookup',
          (await request(`/admin/matches/${vMatch2}/video`, { method: 'DELETE', bearer: vManagerOther[0] })).status === 403)
        check('a manager asking about a match that is not there -> 403, not 404',
          (await request(`/admin/matches/${crypto.randomUUID()}/video`, { method: 'DELETE', bearer: vManager[0] })).status === 403)
        // Two removals at once: both may answer, but Activity says it once.
        const removals = await Promise.all([1, 2].map(() => request(`/admin/matches/${vMatch2}/video`, { method: 'DELETE', bearer: vOwner })))
        const removalStatuses = removals.map((r) => r.status)
        check('the owner removes it, twice at once -> 204 or 404, at least one 204',
          removalStatuses.every((s) => s === 204 || s === 404) && removalStatuses.includes(204), JSON.stringify(removalStatuses))
        check('its file is gone from the bucket', (await fetch(link2)).status === 404)
        const afterRemoval = (await request(`/admin/matches/${vMatch2}`, { bearer: vOwner })).body.match
        check('the match page then has no video, and nothing to remove',
          afterRemoval?.video === null && afterRemoval?.mayRemoveVideo === false, JSON.stringify({ v: afterRemoval?.video, m: afterRemoval?.mayRemoveVideo }))
        const removedAgain = await request(`/admin/matches/${vMatch2}/video`, { method: 'DELETE', bearer: vOwner })
        check('removing it again -> 404', removedAgain.status === 404 && removedAgain.body.error === 'This match has no video', JSON.stringify([removedAgain.status, removedAgain.body]))
        const removedLog = await request('/admin/activity?action=match.video_removed', { bearer: vOwner })
        const removedEntries = (removedLog.body.entries ?? []).filter((e) => e.targetId === vMatch2)
        check('Activity records it exactly once', removedEntries.length === 1, `${removedLog.status}: ${removedEntries.length}`)
        // The removal emptied it: film it again so the cancel below has a file to take away.
        const link3 = await film(vMatch2)
        check('filmed again, it has a video once more', (await fetch(link3)).status === 200)
        check('cancelling that match -> 204', (await request(`/matches/${vMatch2}`, { method: 'DELETE', bearer: token })).status === 204)
        check('and its file is gone from the bucket', (await fetch(link3)).status === 404)

        // ---- A player films, where the facility does not ----
        const pPhone = `smoke-player-phone-${Date.now()}`
        const pOtherPhone = `smoke-other-player-phone-${Date.now()}`
        const pTwoToken = (await asPlayer('/auth/player/claim', {
          method: 'POST', body: { code: (await request(`/players/${vPlayers[1]}/claim-code`, { bearer: token })).body.claimCode },
        })).body.token
        const pBeat = (bearer, body = {}) => asPlayer('/player/video/camera/beat', { method: 'POST', bearer, body: { deviceId: pPhone, state: 'ready', ...body } })
        const pClaim = (bearer, deviceId) => asPlayer(`/player/matches/${pMatch}/video/claim`, { method: 'POST', bearer, body: { deviceId } })
        check("the player's sign-in says video is on", (await asPlayer('/player/me', { bearer: vPlayerToken })).body.videoOn === true)
        check('no token on a player video route -> 401', (await asPlayer('/player/video/camera/beat', { method: 'POST', body: { deviceId: pPhone } })).status === 401)

        const pMatch = crypto.randomUUID()
        const pStartedAt = Date.now()
        await request('/matches', {
          method: 'POST', bearer: token,
          body: { id: pMatch, sessionId: vSession, teamA: [vPlayers[0]], teamB: [vPlayers[1]], stacking: { A: false, B: false },
            firstServer: { team: 'A', playerId: vPlayers[0] }, pointTarget: 11, startedAt: pStartedAt },
        })

        await request(`/admin/facilities/${vFacility.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: true } })
        const pAtFilming = await pClaim(vPlayerToken, pPhone)
        check('where the facility films, a player may not: 409, and it says the facility is filming',
          pAtFilming.status === 409 && pAtFilming.body.covered?.by === 'facility' && pAtFilming.body.covered?.name === vFacility.name, JSON.stringify(pAtFilming.body))
        await request(`/admin/facilities/${vFacility.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: false } })

        const pNamed = await pBeat(vPlayerToken)
        check("a player's beat names the match they are playing, with the time",
          pNamed.status === 200 && pNamed.body.match?.id === pMatch && Math.abs(pNamed.body.now - Date.now()) < 60_000 && /^Smoke Video One/.test(pNamed.body.match?.teamA?.[0] ?? ''),
          JSON.stringify(pNamed.body).slice(0, 160))
        check("a player's beat carries the score too: 0-0, A serving, no server number in singles",
          pNamed.body.match?.score?.a === 0 && pNamed.body.match?.score?.b === 0 && pNamed.body.match?.score?.serving === 'A' && pNamed.body.match?.score?.server === null,
          JSON.stringify(pNamed.body.match?.score))
        check('a player who is not in it is named no match', (await pBeat(vOutsiderToken)).body.match === null)
        check('a beat with no deviceId -> 400', (await asPlayer('/player/video/camera/beat', { method: 'POST', bearer: vPlayerToken, body: {} })).status === 400)
        check('a player who is not in the match cannot claim it -> 404', (await pClaim(vOutsiderToken, pPhone)).status === 404)
        check('a claim with no deviceId -> 400', (await pClaim(vPlayerToken, undefined)).status === 400)
        check('a player in the match claims it -> 201', (await pClaim(vPlayerToken, pPhone)).status === 201)
        check('the same phone again is fine -> 201', (await pClaim(vPlayerToken, pPhone)).status === 201)
        const pSecond = await pClaim(pTwoToken, pOtherPhone)
        check('the other player is refused and told who is filming -> 409',
          pSecond.status === 409 && pSecond.body.covered?.by === 'player' && /^Smoke Video One/.test(pSecond.body.covered?.name ?? ''), JSON.stringify(pSecond.body))
        check("the match's umpire sees it being filmed", (await request(`/video/matches/${pMatch}`, { bearer: token })).body.video?.state === 'filming')

        console.log('  (waiting 61 s, for the first phone to count as gone)')
        await new Promise((resolve) => setTimeout(resolve, 61_000))
        check("after 60 s of silence the other player's phone takes the match over -> 201", (await pClaim(pTwoToken, pOtherPhone)).status === 201)
        const pBack = await pClaim(vPlayerToken, pPhone)
        check('and the first phone is then the one refused, by name -> 409',
          pBack.status === 409 && /^Smoke Video Two/.test(pBack.body.covered?.name ?? ''), JSON.stringify(pBack.body))
        const pFilmingBeat = (bearer, deviceId) => asPlayer('/player/video/camera/beat', { method: 'POST', bearer, body: { deviceId, state: 'filming', matchId: pMatch } })
        const pLost = await pFilmingBeat(vPlayerToken, pPhone)
        check('the phone that lost the match is told so by its own beat, with the name of who films it now',
          pLost.status === 200 && pLost.body.taken?.by === 'player' && /^Smoke Video Two/.test(pLost.body.taken?.name ?? ''), JSON.stringify(pLost.body).slice(0, 200))
        check('a player outside the match who names it in a beat is told nothing about it', (await pFilmingBeat(vOutsiderToken, pPhone)).body.taken == null)
        console.log('  (waiting 35 s, then the holder beats)')
        await new Promise((resolve) => setTimeout(resolve, 35_000))
        // Team A serves first and wins this rally, so the score the next beat carries is 1-0 with A still serving.
        const pPoint = await request(`/matches/${pMatch}/log`, {
          method: 'PUT', bearer: token, body: { deviceId: 'smoke-tablet', events: [{ id: crypto.randomUUID(), seq: 0, type: 'rally', at: pStartedAt + 10_000, actingPlayerId: vPlayers[0], outcome: 'winner', zone: 'baseline' }], sentAt: Date.now() },
        })
        check('a rally is logged on the player match -> 200', pPoint.status === 200, JSON.stringify(pPoint.body).slice(0, 120))
        const pKeep = await asPlayer('/player/video/camera/beat', { method: 'POST', bearer: pTwoToken, body: { deviceId: pOtherPhone, state: 'filming', matchId: pMatch } })
        check("a beat that names the match answers 200 and names it", pKeep.status === 200 && pKeep.body.match?.id === pMatch, JSON.stringify(pKeep.body).slice(0, 120))
        check("and the holder's own beat is not told its match was taken", pKeep.body.taken == null, JSON.stringify(pKeep.body).slice(0, 160))
        check("and its score reads the point: 1-0, A still serving",
          pKeep.body.match?.score?.a === 1 && pKeep.body.match?.score?.b === 0 && pKeep.body.match?.score?.serving === 'A', JSON.stringify(pKeep.body.match?.score))
        console.log('  (waiting 35 s more, 70 s since the takeover)')
        await new Promise((resolve) => setTimeout(resolve, 35_000))
        const pStill = await pClaim(vPlayerToken, pPhone)
        check('a holder that keeps beating keeps the match: 70 s after taking it over, the other phone is still refused -> 409',
          pStill.status === 409 && /^Smoke Video Two/.test(pStill.body.covered?.name ?? ''), JSON.stringify(pStill.body))

        const pEvents = [20_000, 35_000].map((ms, seq) => ({
          id: crypto.randomUUID(), seq, type: 'rally', at: pStartedAt + ms, actingPlayerId: vPlayers[1], outcome: 'winner', zone: 'baseline',
        }))
        const pLogged = await request(`/matches/${pMatch}/log`, {
          method: 'PUT', bearer: token, body: { deviceId: 'smoke-tablet', events: pEvents, sentAt: Date.now(), endedEarly: true, endedEarlyAt: Date.now() },
        })
        check('the tablet ends that match -> 200', pLogged.status === 200 && pLogged.body.match?.status === 'completed', JSON.stringify(pLogged.body).slice(0, 120))
        check('a finished match cannot be claimed -> 404', (await pClaim(vPlayerToken, pPhone)).status === 404)

        const pMeta = { deviceId: pOtherPhone, width: 1280, height: 720, durationMs: 60_000, firstFrameAt: pStartedAt + 2000, repacked: true }
        const pUp = (bearer, body) => asPlayer(`/player/matches/${pMatch}/video/upload`, { method: 'POST', bearer, body })
        const pDone = (bearer, deviceId) => asPlayer(`/player/matches/${pMatch}/video/done`, { method: 'POST', bearer, body: { deviceId } })
        check("a player's video over 2 GB -> 413", (await pUp(pTwoToken, { ...pMeta, bytes: 2 * 1024 ** 3 + 1 })).status === 413)
        check("a player's video with no size -> 400", (await pUp(pTwoToken, { ...pMeta, bytes: 0 })).status === 400)
        check('the player whose claim was taken over cannot send -> 409', (await pUp(vPlayerToken, { ...pMeta, deviceId: pPhone, bytes: 1024 })).status === 409)
        check('the holder cannot send from another phone -> 409', (await pUp(pTwoToken, { ...pMeta, deviceId: pPhone, bytes: 1024 })).status === 409)
        check('a player outside the match cannot send -> 404', (await pUp(vOutsiderToken, { ...pMeta, bytes: 1024 })).status === 404)
        const pForm = await pUp(pTwoToken, { ...pMeta, bytes: 1024 })
        check('the player filming asks to send 1024 bytes -> 200 with a form for the bucket',
          pForm.status === 200 && /^https:\/\//.test(pForm.body.form?.url ?? '') && pForm.body.form?.fields?.['Content-Type'] === 'video/mp4', String(pForm.status))
        check("saying done before sending the player's file -> 409", (await pDone(pTwoToken, pOtherPhone)).status === 409)
        const pFile = new FormData()
        for (const [name, value] of Object.entries(pForm.body.form?.fields ?? {})) pFile.append(name, value)
        pFile.append('file', new Blob([new Uint8Array(1024)], { type: 'video/mp4' }), 'clip.mp4')
        const pStored = await fetch(pForm.body.form.url, { method: 'POST', body: pFile })
        check("the bucket takes the player's file", pStored.status >= 200 && pStored.status < 300, String(pStored.status))
        check('done, said by the other player -> 409', (await pDone(vPlayerToken, pOtherPhone)).status === 409)
        check("the player's done -> 200", (await pDone(pTwoToken, pOtherPhone)).status === 200)

        const pGame = async (bearer) => (await asPlayer(`/player/matches/${pMatch}/game`, { bearer })).body.video
        const pSeenByFilmer = await pGame(pTwoToken)
        const pSeenByOther = await pGame(vPlayerToken)
        check('both players can watch it; only the one who filmed it may remove it',
          /^https:\/\//.test(pSeenByFilmer?.url ?? '') && pSeenByFilmer.mayRemove === true && /^https:\/\//.test(pSeenByOther?.url ?? '') && pSeenByOther.mayRemove === false,
          JSON.stringify([pSeenByFilmer?.mayRemove, pSeenByOther?.mayRemove]))
        check("the match's umpire can watch a player's video too", (await request(`/video/matches/${pMatch}`, { bearer: token })).body.video?.state === 'ready')
        const pRemove = (bearer) => asPlayer(`/player/matches/${pMatch}/video`, { method: 'DELETE', bearer })
        check('the other player cannot remove it -> 404', (await pRemove(vPlayerToken)).status === 404)
        check('a player outside the match cannot remove it -> 404', (await pRemove(vOutsiderToken)).status === 404)
        check('the player who filmed it removes it -> 204', (await pRemove(pTwoToken)).status === 204)
        check('then nobody has a video of that match', (await pGame(pTwoToken)) === null && (await request(`/video/matches/${pMatch}`, { bearer: token })).body.video === null)
        check('and its file is gone from the bucket', (await fetch(pSeenByFilmer.url)).status === 404)
        check('removing it again -> 404', (await pRemove(pTwoToken)).status === 404)
      } finally {
        // Each on its own, so one failing does not leave the facilities filming.
        for (const manager of [vManager, vManagerOther]) {
          if (manager) await request(`/admin/admins/${manager[1]}/switch-off`, { method: 'POST', bearer: vOwner }).catch(() => {})
        }
        if (vStrangerNight) await request(`/sessions/${vStrangerNight[1]}/end`, { method: 'POST', bearer: vStrangerNight[0], body: {} }).catch(() => {})
        await request(`/admin/facilities/${vOther.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: vOtherBefore } }).catch(() => {})
        await request(`/sessions/${vSession}/end`, { method: 'POST', bearer: token, body: {} }).catch(() => {})
        await request(`/admin/facilities/${vFacility.id}`, { method: 'PATCH', bearer: vOwner, body: { filmsMatches: vFilmedBefore } }).catch(() => {})
      }
    }
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

    // --- the "Films matches" switch ---
    check('a new facility does not film', pageA.body.facility?.filmsMatches === false, String(pageA.body.facility?.filmsMatches))
    const filmBAsA = await request(`/admin/facilities/${facilityBId}`, {
      method: 'PATCH', bearer: adminAToken, body: { filmsMatches: true },
    })
    check("admin A switching on facility B's filming -> 404", filmBAsA.status === 404, String(filmBAsA.status))
    const filmBad = await request(`/admin/facilities/${facilityAId}`, {
      method: 'PATCH', bearer: adminAToken, body: { filmsMatches: 'yes' },
    })
    check('a switch that is neither on nor off -> 400',
      filmBad.status === 400 && filmBad.body.error === 'Films matches must be on or off', JSON.stringify(filmBad.body).slice(0, 100))
    const beforeFilm = await countByAction('facility.updated', facilityAId, fOwnerToken)
    const filmOn = await request(`/admin/facilities/${facilityAId}`, {
      method: 'PATCH', bearer: adminAToken, body: { filmsMatches: true },
    })
    check("admin A switches on facility A's filming -> 200, and the answer says so",
      filmOn.status === 200 && filmOn.body.facility?.filmsMatches === true, JSON.stringify(filmOn.body).slice(0, 120))
    const filmActivity = await request('/admin/activity?action=facility.updated', { bearer: fOwnerToken })
    const filmEntry = (filmActivity.body.entries ?? []).find((e) => e.targetId === facilityAId)
    check('Activity records it as a change to match filming',
      (await countByAction('facility.updated', facilityAId, fOwnerToken)) === beforeFilm + 1
        && /^Changed match filming for /.test(filmEntry?.summary ?? ''), String(filmEntry?.summary))
    const filmList = await request('/admin/facilities', { bearer: fOwnerToken })
    check('the facility list says which facility films',
      (filmList.body.facilities ?? []).find((f) => f.id === facilityAId)?.filmsMatches === true
        && (filmList.body.facilities ?? []).find((f) => f.id === facilityBId)?.filmsMatches === false,
      JSON.stringify((filmList.body.facilities ?? []).filter((f) => [facilityAId, facilityBId].includes(f.id)).map((f) => f.filmsMatches)))
    const filmOff = await request(`/admin/facilities/${facilityAId}`, {
      method: 'PATCH', bearer: fOwnerToken, body: { filmsMatches: false },
    })
    check('the owner switches it off again -> 200', filmOff.status === 200 && filmOff.body.facility?.filmsMatches === false,
      JSON.stringify(filmOff.body).slice(0, 120))

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

    // --- 7a: searching the activity record ---
    const searchActivity = async (q, bearer, extra = '') =>
      (await request(`/admin/activity?q=${encodeURIComponent(q)}${extra}`, { bearer })).body.entries ?? []
    const summaries = (entries) => JSON.stringify(entries.map((e) => e.summary)).slice(0, 160)

    const byDetails = await searchActivity(`MADE FACILITY ${nameFacA.toLowerCase()}`, fOwnerToken)
    check('a search finds an entry by its details, whatever the capitals',
      byDetails.length === 1 && byDetails[0].summary === `Made facility ${nameFacA}`, summaries(byDetails))

    const adminAName = `Smoke Facility Admin A ${fStamp}`
    const byWho = await searchActivity(adminAName, fOwnerToken, '&action=invite.created')
    check('a search finds entries by who did them, together with a What filter',
      byWho.length > 0 && byWho.every((e) => e.adminName === adminAName && e.action === 'invite.created' && !e.summary.includes(adminAName)),
      summaries(byWho))

    const anyOneCharacter = await searchActivity(`_${fStamp}`, fOwnerToken)
    const anyCharacters = await searchActivity(`%${fStamp}`, fOwnerToken)
    check('_ and % in a search are plain characters, not wildcards',
      anyOneCharacter.length === 0 && anyCharacters.length === 0, `${anyOneCharacter.length} and ${anyCharacters.length} entries`)

    const bSeenByOwner = await searchActivity(nameFacB, fOwnerToken)
    const bSeenByA = await searchActivity(nameFacB, adminAToken)
    check("a manager's search stays inside their own facility",
      bSeenByOwner.length > 0 && bSeenByA.length === 0, `owner ${bSeenByOwner.length}, manager A ${bSeenByA.length}`)

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

  section('open play — posting, joining, rating')
  if (!ADMIN_SECTION || !OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('  skip (needs a staging or local server, SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)')
  } else {
    // Its own place, umpire, players and session, so the tidy at the end
    // removes them all, and the open play and the rating with them.
    const opStamp = Date.now()
    const placeName = `Smoke Open Play ${opStamp}`
    const opOwnerIn = await request('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
    check('the owner signs in for the open play section -> 200', opOwnerIn.status === 200, String(opOwnerIn.status))
    const opOwnerToken = opOwnerIn.body.token
    const place = await request('/admin/facilities', { method: 'POST', bearer: opOwnerToken, body: { name: placeName } })
    check('the owner adds a place -> 201', place.status === 201, String(place.status))
    const placeId = place.body.facility?.id
    const opInvite = await request('/admin/invites', {
      method: 'POST', bearer: opOwnerToken, body: { note: 'smoke open play', facilityId: placeId },
    })
    const opUmpire = await request('/auth/register', {
      method: 'POST',
      body: {
        email: `smoke.openplay.umpire.${opStamp}@example.com`, name: `Smoke Open Play Umpire ${opStamp}`,
        password: `smk-${uuid()}`, invite: opInvite.body.invite?.code,
      },
    })
    check('an umpire joins that place -> 201', opUmpire.status === 201, String(opUmpire.status))
    const opUmpireToken = opUmpire.body.token
    const players = []
    for (const n of [1, 2, 3]) {
      const name = `Smoke Open Play Player ${n} ${opStamp}`
      const signedUp = await asPlayer('/auth/player/register', {
        method: 'POST', body: { name, username: `smk_op${n}${opStamp}`.slice(0, 20), password: 'not-a-real-password' },
      })
      players.push({ id: signedUp.body.player?.id, token: signedUp.body.token, name })
    }
    check('three players sign up', players.every((p) => p.id && p.token))
    const [one, two, three] = players

    // One and Two play a match there: a visit they can rate, and a shared
    // match, so each may see the other's name.
    const opSessionId = uuid()
    const opSession = await request('/sessions', {
      method: 'POST', bearer: opUmpireToken, body: { id: opSessionId, name: `Smoke Open Play session ${opStamp}` },
    })
    check('the umpire opens a session at the place -> 201',
      opSession.status === 201 && opSession.body.session?.facility_id === placeId, String(opSession.status))
    await request(`/sessions/${opSessionId}/players`, { method: 'PUT', bearer: opUmpireToken, body: { playerIds: [one.id, two.id] } })
    const opMatchId = uuid()
    await request('/matches', {
      method: 'POST', bearer: opUmpireToken,
      body: { id: opMatchId, sessionId: opSessionId, teamA: [one.id], teamB: [two.id], firstServer: { team: 'A', playerId: one.id } },
    })
    const opPlayed = await request(`/matches/${opMatchId}/log`, {
      method: 'PUT', bearer: opUmpireToken,
      body: { deviceId: DEVICE, events: Array.from({ length: 11 }, (_, i) => rally(i, one.id)) },
    })
    check('One and Two play a match there', opPlayed.body.match?.status === 'completed', JSON.stringify(opPlayed.body).slice(0, 100))

    const meInSession = await asPlayer('/player/me', { bearer: one.token })
    check('a player in a session going on: inSession true', meInSession.body.inSession === true, String(meInSession.body.inSession))
    const meNowhere = await asPlayer('/player/me', { bearer: three.token })
    check('a player in no session: inSession false', meNowhere.body.inSession === false, String(meNowhere.body.inSession))

    // --- posting ---
    const today = manilaDayStart(new Date()).getTime()
    const manilaAt = (day, hour) => new Date(today + day * 86_400_000 + hour * 3_600_000).toISOString()
    const opBody = { startsAt: manilaAt(1, 18), endsAt: manilaAt(1, 20), courts: 1, spots: 2, fee: '150', umpire: true, note: 'Smoke test' }
    const addOpenPlay = (body) => request(`/admin/facilities/${placeId}/open-plays`, { method: 'POST', bearer: opOwnerToken, body })
    const added = await addOpenPlay(opBody)
    check('the owner adds an open play, tomorrow 6-8 pm, 2 spots -> 201',
      added.status === 201 && Boolean(added.body.openPlay?.id), JSON.stringify(added.body).slice(0, 120))
    const openPlayId = added.body.openPlay?.id
    const eighthDay = await addOpenPlay({ ...opBody, startsAt: manilaAt(7, 6), endsAt: manilaAt(7, 9) })
    check('the eighth day -> 400, Pick a day in the next 7 days',
      eighthDay.status === 400 && eighthDay.body.error === 'Pick a day in the next 7 days', JSON.stringify(eighthDay.body).slice(0, 100))
    const fiveAm = await addOpenPlay({ ...opBody, startsAt: manilaAt(1, 5), endsAt: manilaAt(1, 7) })
    check('5 am -> 400, Start at 6 am or later',
      fiveAm.status === 400 && fiveAm.body.error === 'Start at 6 am or later', JSON.stringify(fiveAm.body).slice(0, 100))

    const listFor = async (who) => (await asPlayer(`/player/open-plays?facility=${placeId}`, { bearer: who.token })).body.openPlays
    const firstSight = await listFor(one)
    check('a player sees it at the place: nobody going, not them',
      firstSight?.length === 1 && firstSight[0].id === openPlayId && firstSight[0].count === 0 && firstSight[0].you === false
        && firstSight[0].feeCentavos === 15000 && firstSight[0].facility?.name === placeName,
      JSON.stringify(firstSight)?.slice(0, 160))
    const opPlaces = await asPlayer('/player/facilities', { bearer: one.token })
    const opPlaceRow = (opPlaces.body.facilities ?? []).find((f) => f.id === placeId)
    check("the places list carries the place's next open play",
      opPlaceRow?.nextOpenPlay?.startsAt === opBody.startsAt && opPlaceRow?.nextOpenPlay?.endsAt === opBody.endsAt,
      JSON.stringify(opPlaceRow?.nextOpenPlay))

    // --- joining ---
    const join = (who) => asPlayer(`/player/open-plays/${openPlayId}/join`, { method: 'POST', bearer: who.token })
    const joined = await join(one)
    check('One joins -> 200, count 1, you true',
      joined.status === 200 && joined.body.openPlay?.count === 1 && joined.body.openPlay?.you === true, JSON.stringify(joined.body).slice(0, 120))
    const joinedAgain = await join(one)
    check('joining again changes nothing -> 200, count 1',
      joinedAgain.status === 200 && joinedAgain.body.openPlay?.count === 1 && joinedAgain.body.openPlay?.you === true,
      JSON.stringify(joinedAgain.body).slice(0, 120))
    const lastSpot = await join(two)
    check('Two takes the last spot -> 200, count 2, and sees One by name',
      lastSpot.status === 200 && lastSpot.body.openPlay?.count === 2 && JSON.stringify(lastSpot.body.openPlay?.names) === JSON.stringify([one.name]),
      JSON.stringify(lastSpot.body).slice(0, 160))
    const noSpot = await join(three)
    check('Three is refused -> 409, This open play is full',
      noSpot.status === 409 && noSpot.body.error === 'This open play is full', JSON.stringify(noSpot.body).slice(0, 100))
    const strangerSees = (await listFor(three))?.[0]
    check('a stranger sees the count but no names; players in no run count as new',
      strangerSees?.count === 2 && strangerSees.names?.length === 0 && strangerSees.you === false
        && strangerSees.newCount === (strangerSees.levels === null ? 0 : 2),
      JSON.stringify(strangerSees)?.slice(0, 160))

    const guestsFull = await request(`/admin/facilities/${placeId}/guests`, { bearer: opOwnerToken })
    const fullRow = guestsFull.body.openPlays?.[0]
    check('the guests page: 2 coming to 1 open play, 2 of 2 spots taken, FULL',
      guestsFull.status === 200 && fullRow?.status === 'full' && JSON.stringify(guestsFull.body.totals) === JSON.stringify({
        coming: 2, openPlays: 1, taken: 2, spots: 2, next: { startsAt: opBody.startsAt, endsAt: opBody.endsAt, count: 2, spots: 2 },
      }), JSON.stringify(guestsFull.body).slice(0, 200))
    check('and names nobody', Boolean(fullRow) && ['names', 'you', 'atYourLevel', 'facility'].every((key) => !(key in fullRow)),
      JSON.stringify(fullRow)?.slice(0, 160))

    const left = await asPlayer(`/player/open-plays/${openPlayId}/join`, { method: 'DELETE', bearer: one.token })
    check('One leaves -> 200, count 1, you false',
      left.status === 200 && left.body.openPlay?.count === 1 && left.body.openPlay?.you === false, JSON.stringify(left.body).slice(0, 120))

    // --- rating the visit ---
    const rate = (who, body) => asPlayer(`/player/sessions/${opSessionId}/rating`, { method: 'POST', bearer: who.token, body })
    const rated = await rate(one, { score: 5, chips: ['Staff', 'Courts', 'Staff'] })
    check('One rates the visit -> 200, each chip once, in the usual order',
      rated.status === 200 && JSON.stringify(rated.body.visit) === JSON.stringify({
        sessionId: opSessionId, facilityName: placeName, open: true, score: 5, chips: ['Courts', 'Staff'],
      }), JSON.stringify(rated.body).slice(0, 160))
    const changed = await rate(one, { score: 2, chips: ['Price', 'Waiting'] })
    check('and changes it -> 200, Waiting before Price',
      changed.status === 200 && changed.body.visit?.score === 2 && JSON.stringify(changed.body.visit?.chips) === JSON.stringify(['Waiting', 'Price']),
      JSON.stringify(changed.body).slice(0, 160))
    const noFace = await rate(one, { score: 6 })
    check('a score of 6 -> 400, Pick a face', noFace.status === 400 && noFace.body.error === 'Pick a face', JSON.stringify(noFace.body).slice(0, 100))
    const neverPlayed = await rate(three, { score: 4 })
    check("rating a session never played in -> 403, This visit can't be rated",
      neverPlayed.status === 403 && neverPlayed.body.error === "This visit can't be rated", JSON.stringify(neverPlayed.body).slice(0, 100))
    const opHistory = await asPlayer('/player/matches', { bearer: one.token })
    const opVisit = (opHistory.body.matches ?? []).find((m) => m.id === opMatchId)?.visit
    check('the match carries the visit as rated',
      JSON.stringify(opVisit) === JSON.stringify({ sessionId: opSessionId, facilityName: placeName, open: true, score: 2, chips: ['Waiting', 'Price'] }),
      JSON.stringify(opVisit))
    const guestsAfter = await request(`/admin/facilities/${placeId}/guests`, { bearer: opOwnerToken })
    check('the guests page: a spot back, and one rating with no score below three',
      guestsAfter.body.openPlays?.[0]?.status === 'open' && JSON.stringify(guestsAfter.body.visits) === JSON.stringify({
        rated: 1, average: null, faces: [0, 1, 0, 0, 0], good: {}, better: { Waiting: 1, Price: 1 },
      }), JSON.stringify(guestsAfter.body).slice(0, 200))

    // --- the last spot, taken twice at once ---
    const racePlay = await addOpenPlay({ ...opBody, startsAt: manilaAt(2, 18), endsAt: manilaAt(2, 20) })
    const raceJoin = (who) => asPlayer(`/player/open-plays/${racePlay.body.openPlay?.id}/join`, { method: 'POST', bearer: who.token })
    await raceJoin(two)
    const race = await Promise.all([raceJoin(one), raceJoin(three)])
    check('two players race for the last spot: one gets it, the other -> 409, This open play is full',
      race.filter((r) => r.status === 200).length === 1
        && race.filter((r) => r.status === 409 && r.body.error === 'This open play is full').length === 1,
      JSON.stringify(race.map((r) => [r.status, r.body.error ?? r.body.openPlay?.count])))
    await request(`/admin/facilities/${placeId}/open-plays/${racePlay.body.openPlay?.id}`, { method: 'DELETE', bearer: opOwnerToken })

    // --- push alerts: subscribe, join without waiting, unsubscribe ---
    const pushKey = await asPlayer('/player/push/key', { bearer: two.token })
    check('GET /player/push/key -> 200 with a key or null',
      pushKey.status === 200 && (pushKey.body.key === null || typeof pushKey.body.key === 'string'), JSON.stringify(pushKey.body).slice(0, 80))
    if (pushKey.body.key === null) {
      console.log('  note: push keys not set on this server; alert checks skipped')
    } else {
      const push = (method, body) => asPlayer('/player/push', { method, bearer: two.token, body })
      // A valid shape on a real push host, so the push service refuses it (counted as failed or gone) and nothing is delivered.
      const endpoint = `https://fcm.googleapis.com/fcm/send/smoke-${opStamp}`
      const keys = { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') }
      check('a subscription that is not https -> 400',
        (await push('PUT', { endpoint: 'http://x', keys })).status === 400)
      check('a subscription on a host that is not a push service -> 400',
        (await push('PUT', { endpoint: 'https://example.com/x', keys })).status === 400)
      check('keys of the wrong size -> 400',
        (await push('PUT', { endpoint, keys: { p256dh: 'smoke', auth: 'smoke' } })).status === 400)
      check('a good subscription -> 204', (await push('PUT', { endpoint, keys })).status === 204)
      // One and Two split two matches as opponents: rivals, so Two is due an alert when One joins.
      // The smoke cannot read the database; the api log should show `open play alerts queued 1 for <id>`.
      const opMatch2 = uuid()
      await request('/matches', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: opMatch2, sessionId: opSessionId, teamA: [two.id], teamB: [one.id], firstServer: { team: 'A', playerId: two.id } },
      })
      const opPlayed2 = await request(`/matches/${opMatch2}/log`, {
        method: 'PUT', bearer: opUmpireToken,
        body: { deviceId: DEVICE, events: Array.from({ length: 11 }, (_, i) => rally(i, two.id)) },
      })
      check('One and Two play a second match: a 1-1 record', opPlayed2.body.match?.status === 'completed', JSON.stringify(opPlayed2.body).slice(0, 100))
      const alertPlay = await addOpenPlay({ ...opBody, startsAt: manilaAt(4, 18), endsAt: manilaAt(4, 20) })
      const startedAt = Date.now()
      const alertJoin = await asPlayer(`/player/open-plays/${alertPlay.body.openPlay?.id}/join`, { method: 'POST', bearer: one.token })
      const joinMs = Date.now() - startedAt
      check('the joiner joins a fresh open play -> 200, in under 3 s', alertJoin.status === 200 && joinMs < 3000, `${alertJoin.status} ${joinMs} ms`)
      // The sender runs every minute: wait for it so the send path runs once for real.
      console.log('  waiting 70 s for the sender to run once (api log: open play alerts {...})')
      await new Promise((resolve) => setTimeout(resolve, 70_000))
      check('removing the subscription -> 204', (await push('DELETE', { endpoint })).status === 204)
      check('removing without an endpoint -> 400', (await push('DELETE', {})).status === 400)
      await request(`/admin/facilities/${placeId}/open-plays/${alertPlay.body.openPlay?.id}`, { method: 'DELETE', bearer: opOwnerToken })
    }

    // --- a paused player is not counted as going when it is cancelled ---
    const pausedBody = { ...opBody, startsAt: manilaAt(3, 18), endsAt: manilaAt(3, 20) }
    const pausedPlay = await addOpenPlay(pausedBody)
    await asPlayer(`/player/open-plays/${pausedPlay.body.openPlay?.id}/join`, { method: 'POST', bearer: three.token })
    await request(`/admin/players/${three.id}/pause`, { method: 'POST', bearer: opOwnerToken, body: { reason: 'smoke test' } })
    await request(`/admin/facilities/${placeId}/open-plays/${pausedPlay.body.openPlay?.id}`, { method: 'DELETE', bearer: opOwnerToken })
    await request(`/admin/players/${three.id}/unpause`, { method: 'POST', bearer: opOwnerToken })
    const pausedSaid = ((await request(`/admin/activity?facilityId=${placeId}`, { bearer: opOwnerToken })).body.entries ?? []).map((e) => e.summary)
    check('cancelling counts only active players: a paused joiner -> (0 players were going)',
      pausedSaid.includes(`Cancelled open play ${openPlayWhen(pausedBody.startsAt, pausedBody.endsAt)} (0 players were going)`),
      JSON.stringify(pausedSaid).slice(0, 200))

    // --- linking a code keeps the join and the rating ---
    const twoRated = await rate(two, { score: 4, chips: [] })
    const twoRecord = (await request('/players', { method: 'POST', bearer: opUmpireToken, body: { name: `Smoke Open Play Spelling ${opStamp}` } })).body.player?.id
    const twoCode = (await request(`/players/${twoRecord}/claim-code`, { bearer: opUmpireToken })).body.claimCode
    const twoLinked = await asPlayer('/player/link', { method: 'POST', bearer: two.token, body: { code: twoCode, confirm: true } })
    check('Two rates the visit, then links a code -> 200', twoRated.status === 200 && twoLinked.status === 200,
      `${twoRated.status} ${JSON.stringify(twoLinked.body).slice(0, 100)}`)
    Object.assign(two, { id: twoLinked.body.player?.id, token: twoLinked.body.token })
    const twoAfterLink = (await listFor(two))?.[0]
    const guestsLinked = await request(`/admin/facilities/${placeId}/guests`, { bearer: opOwnerToken })
    check('the link keeps their join and their rating',
      twoAfterLink?.you === true && twoAfterLink.count === 1 && guestsLinked.body.visits?.rated === 2,
      `${JSON.stringify(twoAfterLink)?.slice(0, 100)} ${JSON.stringify(guestsLinked.body.visits)}`)

    // --- cancelling ---
    const cancelled = await request(`/admin/facilities/${placeId}/open-plays/${openPlayId}`, { method: 'DELETE', bearer: opOwnerToken })
    check('the owner cancels it -> 204', cancelled.status === 204, String(cancelled.status))
    const afterCancel = await listFor(two)
    check("it is gone, and Two's join with it", afterCancel?.length === 0, JSON.stringify(afterCancel)?.slice(0, 120))
    const joinCancelled = await join(two)
    check('joining it now -> 404, No such open play',
      joinCancelled.status === 404 && joinCancelled.body.error === 'No such open play', JSON.stringify(joinCancelled.body).slice(0, 100))
    const opActivity = await request(`/admin/activity?facilityId=${placeId}`, { bearer: opOwnerToken })
    const opSaid = (opActivity.body.entries ?? []).map((e) => e.summary)
    const opWhen = openPlayWhen(opBody.startsAt, opBody.endsAt)
    check('Activity records it added, then cancelled with who was going',
      opSaid.includes(`Added open play ${opWhen}`) && opSaid.includes(`Cancelled open play ${opWhen} (1 player was going)`),
      JSON.stringify(opSaid).slice(0, 200))

    const opEnded = await request(`/sessions/${opSessionId}/end`, { method: 'POST', bearer: opUmpireToken, body: {} })
    const meAfterEnd = await asPlayer('/player/me', { bearer: one.token })
    check('once the session ends: inSession false',
      opEnded.status === 200 && meAfterEnd.body.inSession === false, `${opEnded.status} ${meAfterEnd.body.inSession}`)

    section('open play courts — start by tapping, named by the server')
    // Live now: starts at the next whole Manila hour (always inside the
    // 1-hour lead). Posting only allows 6 am to 11 pm, so skip outside it.
    let courtPlayId = null
    const nextHour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000)
    const manilaHourNow = (new Date().getUTCHours() + 8) % 24
    if (manilaHourNow < 5 || manilaHourNow >= 22) {
      console.log('  ...  open play courts skipped: an open play can only be posted from 6 am to 11 pm Manila')
    } else {
      const courtPlay = await addOpenPlay({
        startsAt: nextHour.toISOString(), endsAt: new Date(nextHour.getTime() + 3_600_000).toISOString(),
        courts: 2, spots: 8, fee: '', umpire: true, note: '',
      })
      courtPlayId = courtPlay.body.openPlay?.id
      check('an open play starting within the hour, 2 courts -> 201', courtPlay.status === 201, JSON.stringify(courtPlay.body).slice(0, 120))
      const today = await request('/open-plays/today', { bearer: opUmpireToken })
      const listed = today.body.openPlays?.find((p) => p.id === courtPlayId)
      check("the umpire's lookup lists it with 2 open courts",
        listed?.courts.length === 2 && listed.courts.every((c) => c.assignedTo === null && !c.started), JSON.stringify(today.body).slice(0, 160))

      const courtSessionId = uuid()
      const started = await request('/sessions', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: courtSessionId, startsAt: new Date().toISOString(), openPlayId: courtPlayId, court: 1 },
      })
      check('starting Court 1 -> 201, named "Open Play · Court 1 · …", no notice',
        started.status === 201 && /^Open Play · Court 1 · /.test(started.body.session?.name) && !started.body.courtNotice,
        JSON.stringify(started.body).slice(0, 160))
      const again = await request('/sessions', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: uuid(), startsAt: new Date().toISOString(), openPlayId: courtPlayId, court: 1 },
      })
      check('a second start of Court 1 -> 201 as a plain session with the notice',
        again.status === 201 && /^Session · /.test(again.body.session?.name) && /already started by .*Saved as a plain session\.$/.test(again.body.courtNotice ?? ''),
        JSON.stringify(again.body).slice(0, 200))
      const resend = await request('/sessions', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: courtSessionId, startsAt: new Date().toISOString(), openPlayId: courtPlayId, court: 1 },
      })
      check('resending the same session changes nothing, no notice',
        resend.status === 201 && !resend.body.courtNotice && resend.body.session?.court === 1, JSON.stringify(resend.body).slice(0, 160))
      // Void the court's session, start the court again, then restore the first: 200, and it gives the court up.
      const voidCourt = (id, voided) => request(`/sessions/${id}/void`, { method: 'POST', bearer: opUmpireToken, body: { voided } })
      const voidedFirst = await voidCourt(courtSessionId, true)
      const restart = await request('/sessions', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: uuid(), startsAt: new Date().toISOString(), openPlayId: courtPlayId, court: 1 },
      })
      const restored = await voidCourt(courtSessionId, false)
      const heldNow = await request('/open-plays/today', { bearer: opUmpireToken })
      check('restoring a voided court session whose court was started again -> 200, it gives the court up, the new one keeps it',
        voidedFirst.status === 200 && restart.body.session?.court === 1 && restored.status === 200
          && !restored.body.session?.court && !restored.body.session?.openPlayId
          && heldNow.body.openPlays?.find((p) => p.id === courtPlayId)?.courts[0]?.started === true,
        `${voidedFirst.status} ${restored.status} ${JSON.stringify(restored.body).slice(0, 120)}`)
      const plain = await request('/sessions', { method: 'POST', bearer: opUmpireToken, body: { id: uuid(), startsAt: new Date().toISOString() } })
      check('a plain one-tap session -> "Session · …"',
        plain.status === 201 && /^Session · \w{3} \w{3} \d{1,2}, \d{1,2}(:\d{2})? [AP]M$/.test(plain.body.session?.name ?? ''), JSON.stringify(plain.body).slice(0, 160))
      const typed = await request('/sessions', { method: 'POST', bearer: opUmpireToken, body: { id: uuid(), name: 'Saturday Morning Doubles' } })
      check('an old app with a typed name still works',
        typed.status === 201 && typed.body.session?.name === 'Saturday Morning Doubles', JSON.stringify(typed.body).slice(0, 160))
      const after = await request('/open-plays/today', { bearer: opUmpireToken })
      check('the lookup now shows Court 1 started',
        after.body.openPlays?.find((p) => p.id === courtPlayId)?.courts[0]?.started === true, JSON.stringify(after.body).slice(0, 160))

      // A bad open play id never refuses the session either.
      const junk = await request('/sessions', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: uuid(), startsAt: new Date().toISOString(), openPlayId: 'not-a-uuid', court: 1 },
      })
      check('starting a court of a junk open play id -> 201 plain with the notice',
        junk.status === 201 && /^Session · /.test(junk.body.session?.name ?? '') && /Saved as a plain session\.$/.test(junk.body.courtNotice ?? ''),
        JSON.stringify(junk.body).slice(0, 200))

      // The manager's roster: a second umpire at the same place (registered
      // like the first, so the run's tidy removes it with the others).
      const ramilInvite = await request('/admin/invites', {
        method: 'POST', bearer: opOwnerToken, body: { note: 'smoke open play', facilityId: placeId },
      })
      const ramil = await request('/auth/register', {
        method: 'POST',
        body: {
          email: `smoke.openplay.umpire2.${opStamp}@example.com`, name: 'Ramil Ocampo',
          password: `smk-${uuid()}`, invite: ramilInvite.body.invite?.code,
        },
      })
      check('a second umpire joins that place -> 201', ramil.status === 201, String(ramil.status))
      const guestsRoster = await request(`/admin/facilities/${placeId}/guests`, { bearer: opOwnerToken })
      const roster = guestsRoster.body.openPlays?.find((p) => p.id === courtPlayId)?.courtRoster
      check('the guests page lists a roster of 2 courts, Court 1 started, and both umpires',
        roster?.length === 2 && !!roster[0].session?.startedBy && roster[1].session === null &&
          [opUmpire.body.umpire?.id, ramil.body.umpire?.id].every((id) => guestsRoster.body.umpires?.some((u) => u.id === id)),
        JSON.stringify(guestsRoster.body).slice(0, 200))
      const courtUrl = (n) => `/admin/facilities/${placeId}/open-plays/${courtPlayId}/courts/${n}`
      const assign2 = await request(courtUrl(2), { method: 'PUT', bearer: opOwnerToken, body: { umpireId: ramil.body.umpire?.id } })
      check('putting the second umpire on Court 2 -> 200', assign2.status === 200 && assign2.body.court?.court === 2 && assign2.body.court?.umpire?.id === ramil.body.umpire?.id,
        JSON.stringify(assign2.body).slice(0, 160))
      const twice = await request(courtUrl(1), { method: 'PUT', bearer: opOwnerToken, body: { umpireId: ramil.body.umpire?.id } })
      check('the same umpire on Court 1 too -> 409 "… is on Court 2"',
        twice.status === 409 && /is on Court 2$/.test(twice.body.error ?? ''), `${twice.status} ${twice.body.error}`)
      const firstSees = await request('/open-plays/today', { bearer: opUmpireToken })
      const secondSees = await request('/open-plays/today', { bearer: ramil.body.token })
      const courtTwo = (res) => res.body.openPlays?.find((p) => p.id === courtPlayId)?.courts[1]
      check('Court 2 reads "other" to the first umpire and "me" to the second',
        courtTwo(firstSees)?.assignedTo === 'other' && courtTwo(secondSees)?.assignedTo === 'me',
        `${courtTwo(firstSees)?.assignedTo} ${courtTwo(secondSees)?.assignedTo}`)
      const notMine = await request('/sessions', {
        method: 'POST', bearer: opUmpireToken,
        body: { id: uuid(), startsAt: new Date().toISOString(), openPlayId: courtPlayId, court: 2 },
      })
      check("the first umpire starting Court 2 -> 201 plain, \"Court 2 is Ramil's tonight\"",
        notMine.status === 201 && /^Session · /.test(notMine.body.session?.name ?? '') &&
          /^Court 2 is \w+'s tonight\. Saved as a plain session\.$/.test(notMine.body.courtNotice ?? ''),
        JSON.stringify(notMine.body).slice(0, 200))
      const freed = await request(courtUrl(2), { method: 'PUT', bearer: opOwnerToken, body: { umpireId: null } })
      check('leaving Court 2 open to anyone -> 200, umpire null', freed.status === 200 && freed.body.court?.umpire === null, JSON.stringify(freed.body).slice(0, 160))
      const cancelStarted = await request(`/admin/facilities/${placeId}/open-plays/${courtPlayId}`, { method: 'DELETE', bearer: opOwnerToken })
      check('cancelling once a court has started -> 409 "Courts already started"',
        cancelStarted.status === 409 && cancelStarted.body.error === 'Courts already started', `${cancelStarted.status} ${cancelStarted.body.error}`)
      const noUmpirePlay = await addOpenPlay({
        startsAt: new Date(nextHour.getTime() + 24 * 3_600_000).toISOString(),
        endsAt: new Date(nextHour.getTime() + 25 * 3_600_000).toISOString(),
        courts: 2, spots: 8, fee: '', umpire: false, note: '',
      })
      const noUmpireAssign = await request(
        `/admin/facilities/${placeId}/open-plays/${noUmpirePlay.body.openPlay?.id}/courts/1`,
        { method: 'PUT', bearer: opOwnerToken, body: { umpireId: ramil.body.umpire?.id } },
      )
      check('assigning on an open play with no umpire -> 409', noUmpireAssign.status === 409, `${noUmpirePlay.status} ${noUmpireAssign.status}`)
    }

    section('scorekeeper split — a second umpire taps, the match umpire rules')
    // A second umpire at the same place, with a realistic name; the block's tidy removes the place and both.
    const skInvite = await request('/admin/invites', { method: 'POST', bearer: opOwnerToken, body: { note: 'smoke scorekeeper', facilityId: placeId } })
    const skJoined = await request('/auth/register', {
      method: 'POST',
      body: { email: `smoke.scorekeeper.${opStamp}@example.com`, name: 'Paolo Reyes', password: `smk-${uuid()}`, invite: skInvite.body.invite?.code },
    })
    check('a second umpire joins the place -> 201', skJoined.status === 201, String(skJoined.status))
    const skToken = skJoined.body.token
    const skId = skJoined.body.umpire?.id
    const asMain = (path, options = {}) => request(path, { ...options, bearer: opUmpireToken })
    const asSk = (path, options = {}) => request(path, { ...options, bearer: skToken })
    const mainDevice = `${DEVICE}-main`
    const skDevice = `${DEVICE}-sk`

    const skSession = uuid()
    await asMain('/sessions', { method: 'POST', body: { id: skSession, startsAt: new Date().toISOString() } })
    await asMain(`/sessions/${skSession}/players`, { method: 'PUT', body: { playerIds: [players[0].id, players[1].id] } })
    const skMatch = uuid()
    const madeMatch = await asMain('/matches', {
      method: 'POST',
      body: { id: skMatch, sessionId: skSession, teamA: [players[0].id], teamB: [players[1].id], firstServer: { team: 'A', playerId: players[0].id } },
    })
    check('the main umpire starts a singles match -> 201', madeMatch.status === 201, String(madeMatch.status))
    const r0 = rally(0, players[0].id)
    await asMain(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: mainDevice, events: [r0] } })

    const colleagues = await asMain('/scorekeeping/umpires')
    check('the picker lists the other umpire, not me', colleagues.body.umpires?.some((u) => u.id === skId) && !colleagues.body.umpires.some((u) => u.id === opUmpire.body.umpire?.id), JSON.stringify(colleagues.body))
    const bySk = await asSk(`/scorekeeping/${skMatch}`, { method: 'PUT', body: { umpireId: skId, deviceId: skDevice } })
    check('only the match umpire may pick a scorekeeper -> 403', bySk.status === 403, String(bySk.status))
    const asked = await asMain(`/scorekeeping/${skMatch}`, { method: 'PUT', body: { umpireId: skId, deviceId: mainDevice } })
    check('the main umpire asks Paolo -> asked', asked.status === 200 && asked.body.scorekeeper?.state === 'asked', JSON.stringify(asked.body))
    const waiting = await asSk('/scorekeeping/waiting')
    check("it waits on Paolo's Home", waiting.body.matches?.some((m) => m.id === skMatch && m.state === 'asked'), JSON.stringify(waiting.body))
    const notNow = await asSk(`/scorekeeping/${skMatch}/answer`, { method: 'POST', body: { deviceId: skDevice, start: false } })
    check('Not now -> declined', notNow.body.state === 'declined', JSON.stringify(notNow.body))
    await asMain(`/scorekeeping/${skMatch}`, { method: 'PUT', body: { umpireId: skId, deviceId: mainDevice } })
    const started = await asSk(`/scorekeeping/${skMatch}/answer`, { method: 'POST', body: { deviceId: skDevice, start: true } })
    check('asked again, Start -> scoring', started.body.state === 'scoring', JSON.stringify(started.body))
    const mainTaps = await asMain(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: mainDevice, events: [r0, rally(1, players[0].id)] } })
    check("the main umpire's phone can no longer write the log -> 409", mainTaps.status === 409, String(mainTaps.status))

    const r1 = rally(1, players[1].id, 'error')
    await asSk(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: skDevice, events: [r0, r1] } })
    const standsId = uuid()
    const stands = await asMain(`/scorekeeping/${skMatch}/rulings`, { method: 'POST', body: { id: standsId, targetEventId: r1.id, kind: 'stands' } })
    check('a ruling on the last rally -> 201 waiting', stands.status === 201, String(stands.status))
    const again = await asMain(`/scorekeeping/${skMatch}/rulings`, { method: 'POST', body: { id: standsId, targetEventId: r1.id, kind: 'stands' } })
    check('resending the same ruling -> 200, nothing new', again.status === 200, String(again.status))
    const pendingForSk = await asSk(`/scorekeeping/${skMatch}/rulings`)
    check("Paolo's phone sees it waiting", pendingForSk.body.rulings?.length === 1 && pendingForSk.body.rulings[0].id === standsId, JSON.stringify(pendingForSk.body))
    const note = { id: standsId, seq: 2, type: 'ruling', at: Date.now(), targetEventId: r1.id, kind: 'stands', ruledBy: null }
    await asSk(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: skDevice, events: [r0, r1, note] } })
    const afterStands = await asMain(`/matches/${skMatch}`)
    check('the note in the log marks it applied; the score is unchanged',
      afterStands.body.match?.rulings?.[0]?.state === 'applied' && afterStands.body.match.scorekeeper?.state === 'scoring'
        && afterStands.body.match.events?.length === 3 && [r0.id, r1.id].every((id) => afterStands.body.match.events.some((e) => e.id === id)),
      JSON.stringify(afterStands.body.match?.rulings))
    const late = await asMain(`/scorekeeping/${skMatch}/rulings`, { method: 'POST', body: { id: uuid(), targetEventId: r0.id, kind: 'replay' } })
    check('a ruling on an older rally -> 409 too late', late.status === 409 && /^Too late/.test(late.body.error ?? ''), JSON.stringify(late.body))

    const r3 = rally(3, players[0].id)
    await asSk(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: skDevice, events: [r0, r1, note, r3] } })
    const replayId = uuid()
    await asMain(`/scorekeeping/${skMatch}/rulings`, { method: 'POST', body: { id: replayId, targetEventId: r3.id, kind: 'replay' } })
    const replayNote = { id: replayId, seq: 3, type: 'ruling', at: Date.now(), targetEventId: r3.id, kind: 'replay', ruledBy: null, was: { actingPlayerId: players[0].id, outcome: 'winner', zone: 'open' } }
    const replayed = await asSk(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: skDevice, events: [r0, r1, note, replayNote] } })
    check('Replay: the rally is gone, the note stays, applied', replayed.status === 200 && replayed.body.match?.rulings?.find((r) => r.id === replayId)?.state === 'applied'
      && !replayed.body.match.events?.some((e) => e.id === r3.id) && replayed.body.match.events?.some((e) => e.id === replayId && e.type === 'ruling'), JSON.stringify(replayed.body.match?.rulings))

    const r4 = rally(4, players[1].id)
    await asSk(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: skDevice, events: [r0, r1, note, replayNote, r4] } })
    const leftWaiting = uuid()
    const waitingRuling = await asMain(`/scorekeeping/${skMatch}/rulings`, { method: 'POST', body: { id: leftWaiting, targetEventId: r4.id, kind: 'overturned' } })
    const back = await asMain(`/matches/${skMatch}/claim`, { method: 'POST', body: { deviceId: mainDevice, force: true } })
    const afterBack = await asMain(`/matches/${skMatch}`)
    check('taking scoring back ends the split and refuses what was waiting',
      back.status === 200 && afterBack.body.match?.scorekeeper?.state === null && afterBack.body.match.scorekeeper.id === skId
        && waitingRuling.status === 201
        && afterBack.body.match.rulings?.find((r) => r.id === leftWaiting)?.state === 'refused'
        && afterBack.body.match.rulings.find((r) => r.id === leftWaiting).refused === 'Scoring was taken back.',
      JSON.stringify(afterBack.body.match?.scorekeeper))
    const skLate = await asSk(`/matches/${skMatch}/log`, { method: 'PUT', body: { deviceId: skDevice, events: [r0, r1, note, replayNote, r4, rally(5, players[1].id)] } })
    check("Paolo's next upload -> 409", skLate.status === 409, String(skLate.status))
    const skNoMore = await asSk(`/scorekeeping/${skMatch}/rulings`)
    check('and he can no longer read rulings -> 403', skNoMore.status === 403, String(skNoMore.status))

    const elsewhere = await call(`/scorekeeping/${skMatch}/rulings`, { method: 'POST', body: { id: uuid(), targetEventId: r4.id, kind: 'stands' } })
    check("another place's umpire -> 404", elsewhere.status === 404, String(elsewhere.status))
    const junk = await asMain('/scorekeeping/not-a-uuid/rulings', { method: 'POST', body: {} })
    check('a junk match id -> 404, never 500', junk.status === 404, String(junk.status))
    await asMain(`/matches/${skMatch}`, { method: 'DELETE', body: { deviceId: mainDevice } })

    // --- Match point: the winning rally waits for the main umpire ---
    const startSplit = async () => {
      const id = uuid()
      await asMain('/matches', { method: 'POST', body: { id, sessionId: skSession, teamA: [players[0].id], teamB: [players[1].id], firstServer: { team: 'A', playerId: players[0].id } } })
      await asMain(`/scorekeeping/${id}`, { method: 'PUT', body: { umpireId: skId, deviceId: mainDevice } })
      await asSk(`/scorekeeping/${id}/answer`, { method: 'POST', body: { deviceId: skDevice, start: true } })
      return id
    }
    const skLog = (id, events) => asSk(`/matches/${id}/log`, { method: 'PUT', body: { deviceId: skDevice, events: events.map((e, seq) => ({ ...e, seq })) } })
    // match_events.id is a global primary key, so every match needs its own rallies.
    const freshWins = () => Array.from({ length: 10 }, (_, i) => rally(i, players[0].id))
    const tenWins = freshWins()
    const conclude = (id, targetEventId) => asMain(`/matches/${id}/conclude`, { method: 'POST', body: { deviceId: mainDevice, targetEventId } })

    const mp = await startSplit()
    const winAt = Date.now() - 60_000
    const winner = { ...rally(10, players[0].id), at: winAt }
    const heldLog = await skLog(mp, [...tenWins, winner])
    check('the winning rally holds the match open',
      heldLog.status === 200 && heldLog.body.match?.status === 'in_progress' && heldLog.body.match.winner === null && heldLog.body.match.scorekeeper?.state === 'scoring',
      JSON.stringify({ status: heldLog.status, m: heldLog.body.match?.status, w: heldLog.body.match?.winner }))
    const skConcludes = await asSk(`/matches/${mp}/conclude`, { method: 'POST', body: { deviceId: skDevice, targetEventId: winner.id } })
    check('only the main umpire concludes -> 403', skConcludes.status === 403, String(skConcludes.status))
    const staleTarget = await conclude(mp, tenWins[9].id)
    check('conclude on an older event -> 409', staleTarget.status === 409, String(staleTarget.status))

    const undone = await skLog(mp, tenWins)
    const afterUndo = await conclude(mp, winner.id)
    check('after the scorekeeper undoes the winning rally, conclude -> 409 and play goes on',
      undone.body.match?.status === 'in_progress' && afterUndo.status === 409, String(afterUndo.status))

    await skLog(mp, [...tenWins, winner])
    const replayMp = uuid()
    const replayAsk = await asMain(`/scorekeeping/${mp}/rulings`, { method: 'POST', body: { id: replayMp, targetEventId: winner.id, kind: 'replay' } })
    const replayNoteMp = { id: replayMp, type: 'ruling', at: Date.now(), targetEventId: winner.id, kind: 'replay', ruledBy: null, was: { actingPlayerId: players[0].id, outcome: 'winner', zone: 'open' } }
    const replayedMp = await skLog(mp, [...tenWins, replayNoteMp])
    check('Replay on the winning rally removes it and play goes on',
      replayAsk.status === 201 && replayedMp.body.match?.status === 'in_progress', JSON.stringify(replayAsk.body))

    await skLog(mp, [...tenWins, replayNoteMp, winner])
    const overMp = uuid()
    const overAsk = await asMain(`/scorekeeping/${mp}/rulings`, { method: 'POST', body: { id: overMp, targetEventId: winner.id, kind: 'overturned' } })
    const overNote = { id: overMp, type: 'ruling', at: Date.now(), targetEventId: winner.id, kind: 'overturned', ruledBy: null, was: { actingPlayerId: players[0].id, outcome: 'winner', zone: 'open' } }
    const overturnedMp = await skLog(mp, [...tenWins, replayNoteMp, overNote])
    check('Overturned on the winning rally removes it and play goes on',
      overAsk.status === 201 && overturnedMp.body.match?.status === 'in_progress', JSON.stringify(overAsk.body))

    await skLog(mp, [...tenWins, replayNoteMp, overNote, winner])
    const standsMp = uuid()
    await asMain(`/scorekeeping/${mp}/rulings`, { method: 'POST', body: { id: standsMp, targetEventId: winner.id, kind: 'stands' } })
    const standsNote = { id: standsMp, type: 'ruling', at: Date.now(), targetEventId: winner.id, kind: 'stands', ruledBy: null }
    const stoodMp = await skLog(mp, [...tenWins, replayNoteMp, overNote, winner, standsNote])
    check('Stands keeps the match open for the umpire to conclude', stoodMp.body.match?.status === 'in_progress', String(stoodMp.body.match?.status))

    const done = await conclude(mp, standsNote.id)
    const doneMatch = done.body.match
    check('conclude finishes it: winner, end time of the winning rally, split over, scorekeeper still named',
      done.status === 200 && doneMatch?.status === 'completed' && doneMatch.winner === 'A'
        && new Date(doneMatch.endedAt).getTime() === winAt && doneMatch.scorekeeper?.state === null && doneMatch.scorekeeper?.id === skId,
      JSON.stringify({ s: done.status, st: doneMatch?.status, w: doneMatch?.winner, e: doneMatch?.endedAt, sk: doneMatch?.scorekeeper }))
    const repeat = await conclude(mp, standsNote.id)
    check('a repeated conclude -> 200', repeat.status === 200 && repeat.body.match?.status === 'completed', String(repeat.status))
    const lateUpload = await skLog(mp, tenWins)
    check("the scorekeeper's late upload -> 409, the result stands", lateUpload.status === 409, String(lateUpload.status))
    const lateRulings = await asSk(`/scorekeeping/${mp}/rulings`)
    check('and he can no longer read rulings -> 403', lateRulings.status === 403, String(lateRulings.status))
    const lateRuling = await asMain(`/scorekeeping/${mp}/rulings`, { method: 'POST', body: { id: uuid(), targetEventId: standsNote.id, kind: 'replay' } })
    check('a ruling after concluding -> 409', lateRuling.status === 409, String(lateRuling.status))

    // A ruling still waiting when the match ends can no longer apply.
    const mr = await startSplit()
    const mrWinner = rally(10, players[0].id)
    await skLog(mr, [...freshWins(), mrWinner])
    const waitingId = uuid()
    const waitingAsk = await asMain(`/scorekeeping/${mr}/rulings`, { method: 'POST', body: { id: waitingId, targetEventId: mrWinner.id, kind: 'stands' } })
    const mrDone = await conclude(mr, mrWinner.id)
    check('a ruling still waiting is refused as match over',
      waitingAsk.status === 201 && mrDone.body.match?.rulings?.find((r) => r.id === waitingId)?.refused === 'The match has finished.',
      JSON.stringify(mrDone.body.match?.rulings))

    // Taken back while won: nothing finishes by itself.
    const tb = await startSplit()
    const tbWinner = rally(10, players[0].id)
    await skLog(tb, [...freshWins(), tbWinner])
    await asMain(`/matches/${tb}/claim`, { method: 'POST', body: { deviceId: mainDevice, force: true } })
    const afterTb = await asMain(`/matches/${tb}`)
    check('taking scoring back on a won match leaves it open', afterTb.body.match?.status === 'in_progress' && afterTb.body.match.scorekeeper?.state === null, JSON.stringify(afterTb.body.match?.status))
    const tbDone = await conclude(tb, tbWinner.id)
    check('then the umpire concludes it', tbDone.status === 200 && tbDone.body.match?.status === 'completed' && tbDone.body.match.winner === 'A', String(tbDone.status))

    // A ruling still waiting on the winning rally holds Conclude back: it may remove that rally.
    const wo = await startSplit()
    const woWinner = rally(10, players[0].id)
    await skLog(wo, [...freshWins(), woWinner])
    const woRuling = uuid()
    await asMain(`/scorekeeping/${wo}/rulings`, { method: 'POST', body: { id: woRuling, targetEventId: woWinner.id, kind: 'overturned' } })
    const woBlocked = await conclude(wo, woWinner.id)
    check('conclude while an Overturned waits -> 409', woBlocked.status === 409, String(woBlocked.status))
    await asMain(`/matches/${wo}/claim`, { method: 'POST', body: { deviceId: mainDevice, force: true } })
    const woAfter = await conclude(wo, woWinner.id)
    check('after taking back refuses that ruling, conclude -> 200', woAfter.status === 200 && woAfter.body.match?.status === 'completed', String(woAfter.status))

    const tb2 = await startSplit()
    const tb2Winner = rally(10, players[0].id)
    const tb2Wins = freshWins()
    await skLog(tb2, [...tb2Wins, tb2Winner])
    await asMain(`/matches/${tb2}/claim`, { method: 'POST', body: { deviceId: mainDevice, force: true } })
    const mainUndo = await asMain(`/matches/${tb2}/log`, { method: 'PUT', body: { deviceId: mainDevice, events: tb2Wins } })
    check('or undoes the winning rally and plays on', mainUndo.status === 200 && mainUndo.body.match?.status === 'in_progress', String(mainUndo.status))
    const mainWins = await asMain(`/matches/${tb2}/log`, { method: 'PUT', body: { deviceId: mainDevice, events: [...tb2Wins, tb2Winner] } })
    check('with no split left, the winning tap finishes as usual', mainWins.body.match?.status === 'completed', String(mainWins.body.match?.status))

    // Ending early is unchanged: on a won log it still finishes with the winner.
    const ee = await startSplit()
    const eeEvents = [...freshWins(), rally(10, players[0].id)].map((e, seq) => ({ ...e, seq }))
    await skLog(ee, eeEvents)
    const eeEnded = await asSk(`/matches/${ee}/log`, { method: 'PUT', body: { deviceId: skDevice, endedEarly: true, events: eeEvents } })
    check('ending a won match early still finishes it with the winner',
      eeEnded.status === 200 && eeEnded.body.match?.status === 'completed' && eeEnded.body.match.winner === 'A',
      JSON.stringify({ s: eeEnded.status, st: eeEnded.body.match?.status, w: eeEnded.body.match?.winner }))

    // A won match held open for Conclude counts as played: its session cannot be cancelled.
    const cxSession = uuid()
    await asMain('/sessions', { method: 'POST', body: { id: cxSession, startsAt: new Date().toISOString() } })
    await asMain(`/sessions/${cxSession}/players`, { method: 'PUT', body: { playerIds: [players[0].id, players[1].id] } })
    const cxId = uuid()
    await asMain('/matches', { method: 'POST', body: { id: cxId, sessionId: cxSession, teamA: [players[0].id], teamB: [players[1].id], firstServer: { team: 'A', playerId: players[0].id } } })
    await asMain(`/scorekeeping/${cxId}`, { method: 'PUT', body: { umpireId: skId, deviceId: mainDevice } })
    await asSk(`/scorekeeping/${cxId}/answer`, { method: 'POST', body: { deviceId: skDevice, start: true } })
    const cxWins = freshWins()
    const cxHeld = await skLog(cxId, [...cxWins, rally(10, players[0].id)])
    check('a won match is held open', cxHeld.body.match?.status === 'in_progress', String(cxHeld.status))
    const cxMain = await asMain(`/sessions/${cxSession}`, { method: 'DELETE', body: { deviceId: mainDevice } })
    // The wording matters: without this rule the main umpire still gets a 409, from the scorekeeper's lease.
    check('cancelling its session as the main umpire -> 409 finished match', cxMain.status === 409 && /finished match/.test(cxMain.body.error), JSON.stringify(cxMain.body))
    const cxSk = await asSk(`/sessions/${cxSession}`, { method: 'DELETE', body: { deviceId: skDevice } })
    check('and as the scorekeeper -> 409 finished match', cxSk.status === 409 && /finished match/.test(cxSk.body.error), JSON.stringify(cxSk.body))
    const cxKept = await asMain(`/matches/${cxId}`)
    check('the match is still there', cxKept.status === 200, String(cxKept.status))
    await asMain(`/matches/${cxId}/claim`, { method: 'POST', body: { deviceId: mainDevice, force: true } })
    await asMain(`/matches/${cxId}/log`, { method: 'PUT', body: { deviceId: mainDevice, events: cxWins } })
    const cxGone = await asMain(`/sessions/${cxSession}`, { method: 'DELETE', body: { deviceId: mainDevice } })
    check('once the winning rally is undone, cancelling works -> 204', cxGone.status === 204, String(cxGone.status))
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
    check('a warning names its session', m1Warning?.sessionId === sessionAId, String(m1Warning?.sessionId))
    const umpARow = ovAsA.body.umpires?.find((u) => u.id === umpireAId)
    check("a manager's Overview lists their umpire with this week's matches and a last-scored time",
      umpARow?.weekMatches >= 1 && Boolean(umpARow?.lastScoredAt) && umpARow?.paused === false,
      JSON.stringify(ovAsA.body.umpires)?.slice(0, 160))
    check("a manager's umpire list has nobody from another facility",
      Array.isArray(ovAsA.body.umpires) && !ovAsA.body.umpires.some((u) => u.id === umpireBId))
    const pastWhileOpen = await request('/admin/overview/past-sessions', { bearer: adminAToken })
    check('a session still open is not a past session',
      pastWhileOpen.status === 200 && Array.isArray(pastWhileOpen.body.sessions) &&
      !pastWhileOpen.body.sessions.some((s) => s.id === sessionAId), JSON.stringify(pastWhileOpen.body).slice(0, 120))
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
    const weekAfterVoid = afterVoid.body.umpires?.find((u) => u.id === umpireAId)?.weekMatches
    check("a voided match no longer counts in its umpire's week",
      weekAfterVoid === umpARow?.weekMatches - 1, `${weekAfterVoid} after, ${umpARow?.weekMatches} before`)
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
    // --- A manager's past sessions: both of A's are ended by now ---
    const pastA = await request('/admin/overview/past-sessions', { bearer: adminAToken })
    const pastAIds = (pastA.body.sessions ?? []).map((s) => s.id)
    check("a manager's past sessions hold both ended sessions and none of another facility's",
      pastAIds.includes(sessionAId) && pastAIds.includes(session2Id) && !pastAIds.includes(sessionBId), JSON.stringify(pastAIds))
    const pastRowA = (pastA.body.sessions ?? []).find((s) => s.id === sessionAId)
    // M1 was backdated 20 minutes, so its start is earlier than this
    // section's own start; the session itself was opened after it.
    check('a past session is dated by its first match, not by when it was opened',
      Date.parse(pastRowA?.startedAt) < stamp, `${pastRowA?.startedAt} vs ${new Date(stamp).toISOString()}`)
    check('a past session carries its name, its counts and who ran it',
      pastRowA?.name === `Smoke Overview Session A ${stamp}` && pastRowA?.matches >= 1 && pastRowA?.players >= 1 &&
      pastRowA?.openedBy === umpAName, JSON.stringify(pastRowA))
    const newestPast = pastA.body.sessions?.[0]
    const pastOlder = await request(
      `/admin/overview/past-sessions?before=${encodeURIComponent(`${newestPast?.startedAt}|${newestPast?.id}`)}`, { bearer: adminAToken })
    const olderIds = (pastOlder.body.sessions ?? []).map((s) => s.id)
    check('asking for sessions before the newest leaves it out and keeps the rest',
      pastOlder.status === 200 && !olderIds.includes(newestPast?.id) && olderIds.length === pastAIds.length - 1, JSON.stringify(olderIds))
    const pastAsB = await request('/admin/overview/past-sessions', { bearer: adminBToken })
    check("another facility's manager gets none of them",
      pastAsB.status === 200 && !(pastAsB.body.sessions ?? []).some((s) => pastAIds.includes(s.id)),
      JSON.stringify(pastAsB.body).slice(0, 120))
    const pastOwnerA = await request(`/admin/overview/past-sessions?facilityId=${facilityAId}`, { bearer: fOwnerToken })
    check('the owner narrowed to that facility gets the same sessions',
      pastOwnerA.status === 200 && JSON.stringify((pastOwnerA.body.sessions ?? []).map((s) => s.id)) === JSON.stringify(pastAIds),
      JSON.stringify(pastOwnerA.body).slice(0, 120))
    const pastAAskingForB = await request(`/admin/overview/past-sessions?facilityId=${facilityBId}`, { bearer: adminAToken })
    check("a manager who asks for another facility's sessions still gets only their own",
      pastAAskingForB.status === 200 &&
      JSON.stringify((pastAAskingForB.body.sessions ?? []).map((s) => s.id)) === JSON.stringify(pastAIds),
      JSON.stringify(pastAAskingForB.body).slice(0, 120))
    const byUmpire = await request(`/admin/overview/past-sessions?umpireId=${umpireAId}`, { bearer: adminAToken })
    check("past sessions by umpire -> only that umpire's",
      byUmpire.status === 200 && byUmpire.body.sessions.length > 0 && byUmpire.body.sessions.every((s) => s.openedBy === umpAName), JSON.stringify(byUmpire.body).slice(0, 120))
    const sinceTomorrow = await request(`/admin/overview/past-sessions?since=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, { bearer: adminAToken })
    check('past sessions since tomorrow -> none', sinceTomorrow.status === 200 && sinceTomorrow.body.sessions.length === 0, JSON.stringify(sinceTomorrow.body).slice(0, 120))
    const badSince = await request('/admin/overview/past-sessions?since=yesterday', { bearer: adminAToken })
    check('past sessions with an unreadable date -> 400', badSince.status === 400, String(badSince.status))
    const badUmpire = await request('/admin/overview/past-sessions?umpireId=nope', { bearer: adminAToken })
    check('past sessions with a bad umpire -> 400', badUmpire.status === 400, String(badUmpire.status))
    const otherUmpire = await request(`/admin/overview/past-sessions?umpireId=${umpireBId}`, { bearer: adminAToken })
    check("a manager filtering by another facility's umpire sees nothing", otherUmpire.status === 200 && otherUmpire.body.sessions.length === 0, JSON.stringify(otherUmpire.body).slice(0, 120))
    const session2Voided = await request(`/sessions/${session2Id}/void`, { method: 'POST', bearer: umpAToken, body: { reason: 'smoke test' } })
    const pastWithoutVoided = await request('/admin/overview/past-sessions', { bearer: adminAToken })
    check('a voided session is not a past session',
      session2Voided.status === 200 && pastWithoutVoided.status === 200 &&
      !(pastWithoutVoided.body.sessions ?? []).some((s) => s.id === session2Id) &&
      (pastWithoutVoided.body.sessions ?? []).some((s) => s.id === sessionAId),
      `${session2Voided.status} ${JSON.stringify(pastWithoutVoided.body).slice(0, 100)}`)
    const session2Restored = await request(`/sessions/${session2Id}/void`, { method: 'POST', bearer: umpAToken, body: { voided: false } })
    check('restoring the session puts it back -> 200', session2Restored.status === 200, String(session2Restored.status))

    // --- A real second page: four more ended sessions make six, one more than a page holds ---
    for (let i = 3; i <= 6; i += 1) {
      const id = uuid()
      await request('/sessions', { method: 'POST', bearer: umpAToken, body: { id, name: `Smoke Overview Session A${i} ${stamp}` } })
      await request(`/sessions/${id}/end`, { method: 'POST', bearer: umpAToken, body: {} })
    }
    const pastPage1 = await request('/admin/overview/past-sessions', { bearer: adminAToken })
    const page1Ids = (pastPage1.body.sessions ?? []).map((s) => s.id)
    check('six ended sessions: the first page holds five and points at an older one',
      page1Ids.length === 5 && Boolean(pastPage1.body.next), `${page1Ids.length} ${pastPage1.body.next}`)
    const pastPage2 = await request(`/admin/overview/past-sessions?before=${encodeURIComponent(pastPage1.body.next)}`, { bearer: adminAToken })
    // Session A is the oldest: it is dated by M1, which was backdated.
    check('the older page holds the sixth session, repeats none, and is the last',
      JSON.stringify((pastPage2.body.sessions ?? []).map((s) => s.id)) === JSON.stringify([sessionAId]) &&
      !page1Ids.includes(sessionAId) && pastPage2.body.next === null, JSON.stringify(pastPage2.body).slice(0, 160))

    // John claims his record (a code is no sign-in, so he can still be
    // merged away), joins open play at A and rates his visit there.
    const johnCode = (await request(`/players/${johnId}/claim-code`, { bearer: umpAToken })).body.claimCode
    const johnToken = (await asPlayer('/auth/player/claim', { method: 'POST', body: { code: johnCode } })).body.token
    const ovDay = manilaDayStart(new Date()).getTime() + 86_400_000
    const ovPlay = await request(`/admin/facilities/${facilityAId}/open-plays`, {
      method: 'POST', bearer: fOwnerToken,
      body: { startsAt: new Date(ovDay + 18 * 3_600_000).toISOString(), endsAt: new Date(ovDay + 20 * 3_600_000).toISOString(), courts: 1, spots: 8, umpire: false },
    })
    const johnJoined = await asPlayer(`/player/open-plays/${ovPlay.body.openPlay?.id}/join`, { method: 'POST', bearer: johnToken })
    const johnRated = await asPlayer(`/player/sessions/${session2Id}/rating`, { method: 'POST', bearer: johnToken, body: { score: 4, chips: [] } })
    check('John claims his record, joins open play at A and rates his visit',
      ovPlay.status === 201 && johnJoined.status === 200 && johnRated.status === 200, `${ovPlay.status} ${johnJoined.status} ${johnRated.status}`)

    const wrongName = await request('/admin/overview/merge', {
      method: 'POST', bearer: fOwnerToken, body: { keepId: jonId, removeId: johnId, confirmName: 'nope' },
    })
    check('merge needs the removed name typed -> 400', wrongName.status === 400, JSON.stringify(wrongName.body))
    const merged = await request('/admin/overview/merge', {
      method: 'POST', bearer: fOwnerToken, body: { keepId: jonId, removeId: johnId, confirmName: johnName },
    })
    check('merge -> 200 with one match moved', merged.status === 200 && merged.body.movedMatches === 1, JSON.stringify(merged.body))

    const guestsA = await request(`/admin/facilities/${facilityAId}/guests`, { bearer: fOwnerToken })
    check("the merge keeps John's join and his rating, now Jon's",
      guestsA.body.openPlays?.[0]?.count === 1 && guestsA.body.visits?.rated === 1, JSON.stringify(guestsA.body).slice(0, 200))

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
  const tidy = await tidyStaging()
  if (tidy) {
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

// Tidy first: it removes the sessions too, and closing them can hang after a dropped connection.
async function tidyAndExit() {
  await tidyStaging()?.catch(() => {})
  await closeOpenSessions().catch(() => {})
  process.exit(1)
}

main().catch(async (error) => {
  console.error('\nsmoke test crashed:', error)
  // A crash used to skip the tidy and leave "Smoke ..." players on staging.
  await tidyAndExit()
})

// A stop from outside (a timeout running out, Ctrl+C) skipped the tidy too.
// `once`, so a second Ctrl+C still quits straight away.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    console.error(`\nsmoke test stopped (${signal}), tidying staging first`)
    await tidyAndExit()
  })
}
