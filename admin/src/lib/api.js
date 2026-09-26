// ============================================================
// The admin site's API client. Every call goes to /admin/* on the API.
// ============================================================

const API_URL = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

// Distinct from the umpire and player apps' keys, so the three can never
// overwrite each other's sessions.
const TOKEN_KEY = 'paddlepad.admin.token'
const ADMIN_KEY = 'paddlepad.admin'
// No longer written: Account now asks the server (`viaBackupCode` on
// `/admin/auth/me` and on every response that mints a fresh token)
// instead of remembering a flag from the moment someone signed in. Kept
// only so any leftover key from before this change is cleared away.
const USED_BACKUP_CODE_KEY = 'paddlepad.admin.usedBackupCode'

/** Fired when the server says a signed-in session has ended. */
export const SIGNED_OUT_EVENT = 'paddlepad-admin-signed-out'

export class ApiError extends Error {
  constructor(message, status, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function getStoredAdmin() {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function storeAdmin(admin) {
  try { localStorage.setItem(ADMIN_KEY, JSON.stringify(admin)) } catch { /* private mode */ }
}

function storeSession(token, admin) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* private mode */ }
  storeAdmin(admin)
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ADMIN_KEY)
    sessionStorage.removeItem(USED_BACKUP_CODE_KEY)
  } catch { /* nothing to do */ }
}

async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = auth ? getToken() : null
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0)
  }

  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // A signed-in request answered 401 means the session is over: it
    // expired, or this admin was paused.
    if (token && response.status === 401) {
      clearSession()
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    }
    throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status, data)
  }
  return data
}

const post = (path, body) => apiFetch(path, { method: 'POST', body })

// Signing in and setting up

export async function signIn({ email, password }) {
  const data = await apiFetch('/admin/auth/login', { method: 'POST', auth: false, body: { email, password } })
  storeSession(data.token, data.admin)
  return data.admin
}

export async function signInWithGoogle(accessToken) {
  const data = await apiFetch('/admin/auth/google', { method: 'POST', auth: false, body: { accessToken } })
  storeSession(data.token, data.admin)
  return data.admin
}

export function readSetupLink(secret) {
  return apiFetch(`/admin/auth/setup/${encodeURIComponent(secret)}`, { auth: false })
}

export async function completeSetup(secret, { password, accessToken }) {
  const data = await apiFetch(`/admin/auth/setup/${encodeURIComponent(secret)}`, {
    method: 'POST', auth: false, body: { password: password || undefined, accessToken: accessToken || undefined },
  })
  storeSession(data.token, data.admin)
  return data.admin
}

// Your own account

export const fetchMe = () => apiFetch('/admin/auth/me').then((d) => d.admin)
export const fetchMeWithCodes = () => apiFetch('/admin/auth/me')
export const renameMe = (name) => apiFetch('/admin/auth/me', { method: 'PATCH', body: { name } }).then((d) => d.admin)

// The four calls below mint a fresh token, and the server always mints
// it with no backup-code claim (see admin-auth.js), so each also hands
// back `viaBackupCode: false` for Account to fold into its own state
// straight away, rather than waiting on a fresh `/me`.

export async function changePassword({ proof, newPassword }) {
  const data = await post('/admin/auth/me/password', { ...proof, newPassword })
  storeSession(data.token, data.admin)
  return { admin: data.admin, viaBackupCode: data.viaBackupCode }
}

export async function connectGoogle(accessToken, proof) {
  const data = await post('/admin/auth/me/google/connect', { ...proof, accessToken })
  storeSession(data.token, data.admin)
  return { admin: data.admin, viaBackupCode: data.viaBackupCode }
}

export async function disconnectGoogle(proof) {
  const data = await post('/admin/auth/me/google/disconnect', { ...proof })
  storeSession(data.token, data.admin)
  return { admin: data.admin, viaBackupCode: data.viaBackupCode }
}

export async function signOutOthers() {
  const data = await post('/admin/auth/me/sign-out-others')
  storeSession(data.token, data.admin)
  return { admin: data.admin, viaBackupCode: data.viaBackupCode }
}

export async function makeBackupCodes(proof) {
  const data = await post('/admin/auth/me/backup-codes', { ...proof })
  storeSession(data.token, data.admin)
  return { codes: data.codes, viaBackupCode: data.viaBackupCode }
}

export async function signInWithBackupCode({ email, code }) {
  const data = await apiFetch('/admin/auth/backup-code', { method: 'POST', auth: false, body: { email, code } })
  storeSession(data.token, data.admin)
  return data.admin
}

// Invite codes

export function listInvites({ facilityId } = {}) {
  const params = new URLSearchParams()
  if (facilityId) params.set('facilityId', facilityId)
  const qs = params.toString()
  return apiFetch(`/admin/invites${qs ? `?${qs}` : ''}`).then((d) => d.invites)
}
export const createInvite = ({ note, expiresInDays, facilityId }) =>
  post('/admin/invites', { note, expiresInDays, facilityId }).then((d) => d.invite)
export const cancelInvite = (code) => apiFetch(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })

// Admins (owner only)

export const listAdmins = () => apiFetch('/admin/admins').then((d) => d.admins)
export const addAdmin = ({ name, email, facilityId }) => post('/admin/admins', { name, email, facilityId })
export const newSetupLink = (id) => post(`/admin/admins/${id}/setup-link`).then((d) => d.setupLink)
export const switchAdmin = (id, on) => post(`/admin/admins/${id}/switch-${on ? 'on' : 'off'}`).then((d) => d.admin)
export const moveAdmin = (id, facilityId) => post(`/admin/admins/${id}/move`, { facilityId }).then((d) => d.admin)

// Facilities

export const listFacilities = () => apiFetch('/admin/facilities').then((d) => d.facilities)
export const fetchFacility = (id) => apiFetch(`/admin/facilities/${id}`)
export const createFacility = (fields) => post('/admin/facilities', fields).then((d) => d.facility)
export const updateFacility = (id, fields) => apiFetch(`/admin/facilities/${id}`, { method: 'PATCH', body: fields }).then((d) => d.facility)
export const uploadFacilityLogo = (id, logo) =>
  apiFetch(`/admin/facilities/${id}/logo`, { method: 'PUT', body: logo }).then((d) => d.facility)
export const removeFacilityLogo = (id) =>
  apiFetch(`/admin/facilities/${id}/logo`, { method: 'DELETE' }).then((d) => d.facility)

/** Where an <img> loads a facility's logo from, or null when it has none. */
export function logoSrc(logoUrl, { small = false } = {}) {
  return logoUrl ? `${API_URL}${logoUrl}${small ? '&size=small' : ''}` : null
}

// Activity

export function listActivity({ before, adminId, action, facilityId } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  if (adminId) params.set('adminId', adminId)
  if (action) params.set('action', action)
  if (facilityId) params.set('facilityId', facilityId)
  const qs = params.toString()
  return apiFetch(`/admin/activity${qs ? `?${qs}` : ''}`)
}

export const activityFilters = () => apiFetch('/admin/activity/filters')

// People

function peopleQuery({ q, status, after, facilityId } = {}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status && status !== 'all') params.set('status', status)
  if (after) params.set('after', after)
  if (facilityId) params.set('facilityId', facilityId)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const listPlayers = (options) => apiFetch(`/admin/players${peopleQuery(options)}`)
export const listUmpires = (options) => apiFetch(`/admin/umpires${peopleQuery(options)}`)
export const fetchPlayer = (id) => apiFetch(`/admin/players/${id}`).then((d) => d.player)
export const fetchUmpire = (id) => apiFetch(`/admin/umpires/${id}`).then((d) => d.umpire)
export const pausePerson = (kind, id, reason) => post(`/admin/${kind}/${id}/pause`, { reason })
export const unpausePerson = (kind, id) => post(`/admin/${kind}/${id}/unpause`)
export const closePerson = (kind, id, { reason, confirmName }) => post(`/admin/${kind}/${id}/close`, { reason, confirmName })
export const newClaimCode = (id) => post(`/admin/players/${id}/claim-code`).then((d) => d.claimCode)
export const moveUmpire = (id, facilityId) => post(`/admin/umpires/${id}/move`, { facilityId }).then((d) => d.umpire)

// --- Overview ---
export function fetchOverview({ facilityId } = {}) {
  const query = facilityId ? `?facilityId=${encodeURIComponent(facilityId)}` : ''
  return apiFetch(`/admin/overview${query}`)
}
export const markLooksFine = (matchId, reason) => post('/admin/overview/looks-fine', { matchId, reason })
export const voidMatch = (matchId, reason) => post('/admin/overview/void', { matchId, reason })
export const unvoidMatch = (matchId) => post('/admin/overview/unvoid', { matchId })
export const markNotSamePerson = (a, b) => post('/admin/overview/not-same-person', { playerIds: [a, b] })
export const mergePlayers = ({ keepId, removeId, confirmName }) => post('/admin/overview/merge', { keepId, removeId, confirmName })
export const closeSession = (sessionId, reason) => post(`/admin/overview/sessions/${sessionId}/close`, { reason })
