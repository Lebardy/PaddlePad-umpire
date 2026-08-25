// ============================================================
// API client for the player app.
//
// A trimmed copy of the umpire app's client, not an import of it: a
// Railway service only uploads what lives under its root directory, so
// reaching into ../src would work locally and break in production.
//
// This app is READ-ONLY. There are no writes, no outbox, no sync queue
// and no scoring engine here -- all of that exists in the umpire app to
// let someone keep tapping with no signal, and none of it applies to
// looking at your own stats.
// ============================================================

const API_URL = (
  import.meta.env?.VITE_API_URL ?? 'http://localhost:3000'
).replace(/\/$/, '')

// Deliberately distinct from the umpire app's 'paddlepad.token'. The two
// apps sit on different origins today so there is no collision, but if
// they ever shared a domain a player token would silently overwrite an
// umpire's session.
const TOKEN_KEY = 'paddlepad.player.token'
const PLAYER_KEY = 'paddlepad.player'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getStoredPlayer() {
  try {
    const raw = localStorage.getItem(PLAYER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeSession(token, player) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(PLAYER_KEY, JSON.stringify(player))
  } catch {
    // Private mode. The session lasts this tab only, which still works.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PLAYER_KEY)
  } catch {
    // nothing useful to do
  }
}

async function apiFetch(path, { method = 'GET', body, auth = true, signal } = {}) {
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
    // An abort is the caller's own doing; only a genuine network
    // failure should read as "you're offline".
    if (error?.name === 'AbortError') throw error
    throw new ApiError("Can't reach the server. Check your connection.", 0)
  }

  if (response.status === 204) return null

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status)
  }
  return data
}

/** Exchanges a claim code for a player session. */
export async function claim(code) {
  const data = await apiFetch('/auth/player/claim', {
    method: 'POST',
    auth: false,
    body: { code },
  })
  storeSession(data.token, data.player)
  return data.player
}

/** Profile plus headline totals. */
export function fetchMe({ signal } = {}) {
  return apiFetch('/player/me', { signal })
}

/** Every match this player has played, newest first. */
export function fetchMatches({ signal } = {}) {
  return apiFetch('/player/matches', { signal }).then((d) => d.matches)
}

/**
 * Confirms a stored token still works on launch.
 *
 * Returns null when the token has been rejected, so the app shows the
 * claim screen. A NETWORK failure re-throws instead -- being briefly
 * offline shouldn't sign anyone out.
 */
export async function verifySession() {
  if (!getToken()) return null
  try {
    const data = await apiFetch('/auth/player/me')
    return data.player
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearSession()
      return null
    }
    throw error
  }
}
