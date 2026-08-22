// ============================================================
// API client
//
// Talks to the Express server in server/. The base URL comes from
// VITE_API_URL at build time (see .env.example); it falls back to a
// local dev server so `pnpm dev` works with no configuration.
// ============================================================

const API_URL = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
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

async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
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
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only rejects on network-level failure, so this is the
    // "server unreachable" case rather than an application error --
    // worth naming explicitly, since courtside wifi is unreliable.
    throw new ApiError(
      `Can't reach the server at ${API_URL}. Check your connection.`,
      0,
    )
  }

  if (response.status === 204) return null

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status)
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
    return data.umpire
  } catch (error) {
    if (error.status === 401) {
      clearSession()
      return null
    }
    throw error
  }
}
