// ============================================================
// API client
//
// Talks to the Express server in server/. The base URL comes from
// VITE_API_URL at build time (see .env.example); it falls back to a
// local dev server so `pnpm dev` works with no configuration.
// ============================================================

// Optional-chained so this module can also be imported outside Vite
// (the sync tests run it under plain Node), where import.meta.env does
// not exist at all.
const API_URL = (
  import.meta.env?.VITE_API_URL ?? 'http://localhost:3000'
).replace(/\/$/, '')

const TOKEN_KEY = 'paddlepad.token'
const UMPIRE_KEY = 'paddlepad.umpire'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** The signed-in umpire, read from local storage without a round trip. */
export function getStoredUmpire() {
  try {
    const raw = localStorage.getItem(UMPIRE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeSession(token, umpire) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(UMPIRE_KEY, JSON.stringify(umpire))
}

/**
 * Updates the stored umpire without touching the token.
 *
 * For /auth/me, which hands back the account as it now stands but no
 * new token. Without this the stored copy keeps whatever the last
 * sign-in wrote, so an account screen opened offline would show details
 * that changed weeks ago.
 */
function storeUmpire(umpire) {
  try {
    localStorage.setItem(UMPIRE_KEY, JSON.stringify(umpire))
  } catch {
    // Private mode or a full disk. The in-memory copy is still right.
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(UMPIRE_KEY)
}

/**
 * Thrown for any non-2xx response. `status` is kept so callers can
 * distinguish "your token expired" (401) from a genuine failure.
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiFetch(
  path,
  { method = 'GET', body, auth = true, signal, raw = false } = {},
) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // An aborted request is the caller's own doing, not a failure of
    // the network -- rethrow it so it can't be mistaken for offline.
    if (error?.name === 'AbortError') throw error
    // fetch only rejects on network-level failure, so this is the
    // "server unreachable" case rather than an application error --
    // worth naming explicitly, since courtside wifi is unreliable.
    throw new ApiError(
      `Can't reach the server at ${API_URL}. Check your connection.`,
      0,
    )
  }

  if (response.status === 204) return null

  // `raw` is for responses that aren't JSON -- the CSV export.
  if (raw) {
    if (!response.ok) {
      throw new ApiError(`Request failed (${response.status})`, response.status)
    }
    return response
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new ApiError(
      data.error ?? `Request failed (${response.status})`,
      response.status,
    )
    // Some errors carry useful payload: a duplicate player carries the
    // existing player, a busy match carries who is holding it.
    error.data = data
    throw error
  }
  return data
}

export async function register({ email, name, password, invite }) {
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    auth: false,
    body: { email, name, password, invite },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

// ============================================================
// Invites
//
// Registration is invite-only because the API is public. These are
// how an existing umpire brings in a new one.
// ============================================================

export function listInvites() {
  return apiFetch('/invites').then((data) => data.invites)
}

export function createInvite({ note, expiresInDays } = {}) {
  return apiFetch('/invites', {
    method: 'POST',
    body: { note, ...(expiresInDays === undefined ? {} : { expiresInDays }) },
  }).then((data) => data.invite)
}

export function revokeInvite(code) {
  return apiFetch(`/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

/**
 * Signs in with Google.
 *
 * `invite` is only needed the first time an unknown Google account
 * appears -- registration stays invite-only whichever door is used. The
 * server answers that case with `needsInvite`, which the login screen
 * reads to reveal the field rather than showing a dead end.
 */
export async function loginWithGoogle({ accessToken, invite }) {
  const data = await apiFetch('/auth/google', {
    method: 'POST',
    auth: false,
    body: { accessToken, invite: invite || undefined },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

/**
 * Attaches a Google account to an umpire account that already exists.
 *
 * For the person whose Google address is not the address they signed up
 * with -- /auth/google links those automatically, this is the rest.
 * Their password proves the account here is theirs; Google has already
 * proved the other half.
 */
export async function linkGoogleAccount({ accessToken, email, password }) {
  const data = await apiFetch('/auth/google/link', {
    method: 'POST',
    auth: false,
    body: { accessToken, email, password },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

export async function login({ email, password }) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

/**
 * ============================================================
 * The umpire's own account.
 *
 * Every one of these returns a fresh token alongside the umpire, and
 * every one of them stores it, so the header name and anything else
 * reading the stored umpire follow immediately without a reload.
 * ============================================================
 */

/** Changes the display name, the sign-in email, or both. */
export async function updateUmpire({ name, email, currentPassword }) {
  const data = await apiFetch('/auth/me', {
    method: 'PATCH',
    body: { name, email, currentPassword },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

/**
 * Changes the password, or sets the first one for an umpire who signed
 * up through Google and has never had one.
 */
export async function changeUmpirePassword({ currentPassword, password }) {
  const data = await apiFetch('/auth/me/password', {
    method: 'POST',
    body: { currentPassword, password },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

/**
 * Connects Google to the account already signed in.
 *
 * Not the same endpoint as linkGoogleAccount above, and it could not
 * be: that one is for someone at the sign-in gate proving an account
 * with its email and password, this one for someone already inside. An
 * umpire mid-session must not have to sign out to connect Google.
 */
export async function connectGoogle({ accessToken, currentPassword }) {
  const data = await apiFetch('/auth/google/connect', {
    method: 'POST',
    body: { accessToken, currentPassword },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

/** Disconnects it again. Refused when it would leave no way back in. */
export async function disconnectGoogle({ currentPassword }) {
  const data = await apiFetch('/auth/google/disconnect', {
    method: 'POST',
    body: { currentPassword },
  })
  storeSession(data.token, data.umpire)
  return data.umpire
}

/**
 * Confirms a stored token is still valid. Called once on launch so an
 * expired session lands on the login screen immediately, rather than
 * failing on the first real request in the middle of a match.
 *
 * Returns null if there's no token or it's been rejected. A network
 * failure re-throws instead, so being briefly offline doesn't sign an
 * umpire out mid-session.
 */
export async function fetchCurrentUmpire() {
  if (!getToken()) return null
  try {
    const data = await apiFetch('/auth/me')
    storeUmpire(data.umpire)
    return data.umpire
  } catch (error) {
    if (error.status === 401) {
      clearSession()
      return null
    }
    throw error
  }
}

// ============================================================
// Players
//
// Player creation is the one write that requires connectivity, and
// deliberately so. Players are the only entity with a semantic unique
// key (one name, one person), so if two offline devices each invented
// an id for "Maria" only one could survive, and reconciling would mean
// rewriting that id across sessions, matches, both team arrays and
// every event payload on both devices -- reintroducing exactly the
// identity fragmentation the shared player table exists to prevent.
//
// Adding a person is a setup action, not a mid-rally one, so it can
// afford to need a connection. Scoring stays fully offline.
// ============================================================

export function searchPlayers(q = '', { signal } = {}) {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : ''
  return apiFetch(`/players${suffix}`, { signal }).then((d) => d.players)
}

/**
 * Creates a player. On a duplicate name the thrown ApiError has
 * `.status === 409` and `.data.player` holding the existing record and
 * its match count, so the caller can offer "same person?" without a
 * second round trip.
 */
export function createPlayer(name) {
  return apiFetch('/players', { method: 'POST', body: { name } }).then((d) => d.player)
}

export function fetchPlayerClaimCode(playerId) {
  return apiFetch(`/players/${playerId}/claim-code`).then((d) => d.claimCode)
}

// ============================================================
// Sessions
// ============================================================

export function fetchSessions({ signal } = {}) {
  return apiFetch('/sessions', { signal }).then((d) => d.sessions)
}

export function fetchSession(sessionId, { signal } = {}) {
  return apiFetch(`/sessions/${sessionId}`, { signal })
}

export function pushSession({ id, name }) {
  return apiFetch('/sessions', { method: 'POST', body: { id, name } }).then((d) => d.session)
}

/** Replaces a session's whole roster; see the route for why it's a replace. */
export function pushRoster(sessionId, playerIds) {
  return apiFetch(`/sessions/${sessionId}/players`, {
    method: 'PUT',
    body: { playerIds },
  })
}

// ============================================================
// Matches
// ============================================================

export function fetchMatchesForSession(sessionId, { signal } = {}) {
  return apiFetch(`/matches/session/${sessionId}`, { signal }).then((d) => d.matches)
}

export function fetchMatch(matchId, { signal } = {}) {
  return apiFetch(`/matches/${matchId}`, { signal }).then((d) => d.match)
}

export function pushMatch(match) {
  return apiFetch('/matches', {
    method: 'POST',
    body: {
      id: match.id,
      sessionId: match.sessionId,
      teamA: match.teamA,
      teamB: match.teamB,
      stacking: match.stacking,
      firstServer: match.firstServer,
      rightStart: match.rightStart ?? undefined,
      pointTarget: match.pointTarget,
      startedAt: match.startedAt,
    },
  }).then((d) => d.match)
}

/**
 * Uploads a match's whole event log: "this match's log is exactly
 * this." Full-state rather than append/undo operations, so a retry is
 * free and an undo is just a shorter array.
 *
 * A 409 means another device holds the scoring lease; the error carries
 * `.data.heldBy`.
 */
export function pushMatchLog(matchId, { deviceId, events, endedEarly, endedEarlyAt }) {
  return apiFetch(`/matches/${matchId}/log`, {
    method: 'PUT',
    body: { deviceId, events, endedEarly, endedEarlyAt },
  }).then((d) => d.match)
}

export function claimMatch(matchId, { deviceId, force = false }) {
  return apiFetch(`/matches/${matchId}/claim`, {
    method: 'POST',
    body: { deviceId, force },
  }).then((d) => d.match)
}

// ============================================================
// Export
// ============================================================

/** The ML pipeline CSV, covering every umpire's matches. */
export function fetchExportCsv() {
  return apiFetch('/export/match-logs.csv', { raw: true }).then((r) => r.text())
}

/** Cancels an unfinished match. Idempotent server-side. */
export function deleteMatchOnServer(matchId) {
  return apiFetch(`/matches/${matchId}`, { method: 'DELETE' })
}

/** Voids (or un-voids) a finished match, excluding it from the export. */
export function setMatchVoided(matchId, { voided, reason }) {
  return apiFetch(`/matches/${matchId}/void`, {
    method: 'POST',
    body: { voided, reason },
  }).then((d) => d.match)
}

/** Cancels a session and its unfinished matches. Idempotent server-side. */
export function deleteSessionOnServer(sessionId) {
  return apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' })
}

/** Voids (or restores) a session, excluding all its matches from the export. */
export function setSessionVoided(sessionId, { voided, reason }) {
  return apiFetch(`/sessions/${sessionId}/void`, {
    method: 'POST',
    body: { voided, reason },
  }).then((d) => d.session)
}

/**
 * Ends a session, or reopens it.
 *
 * Separate from voiding on purpose: voiding says a session should never
 * have counted, ending says the night is over and every match in it
 * still counts.
 */
export function setSessionEnded(sessionId, { ended = true } = {}) {
  return apiFetch(`/sessions/${sessionId}/end`, {
    method: 'POST',
    body: { ended },
  }).then((d) => d.session)
}
