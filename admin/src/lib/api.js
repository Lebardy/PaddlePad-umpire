// ============================================================
// The admin site's API client. Every call goes to /admin/* on the API.
// ============================================================

const API_URL = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

// Distinct from the umpire and player apps' keys, so the three can never
// overwrite each other's sessions.
const TOKEN_KEY = 'paddlepad.admin.token'
const ADMIN_KEY = 'paddlepad.admin'

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
    // expired, or this admin was switched off.
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
export const renameMe = (name) => apiFetch('/admin/auth/me', { method: 'PATCH', body: { name } }).then((d) => d.admin)
export const changePassword = ({ currentPassword, newPassword }) =>
  post('/admin/auth/me/password', { currentPassword: currentPassword || undefined, newPassword }).then((d) => d.admin)
export const connectGoogle = (accessToken) => post('/admin/auth/me/google/connect', { accessToken }).then((d) => d.admin)
export const disconnectGoogle = () => post('/admin/auth/me/google/disconnect').then((d) => d.admin)

// Invite codes

export const listInvites = () => apiFetch('/admin/invites').then((d) => d.invites)
export const createInvite = ({ note, expiresInDays }) => post('/admin/invites', { note, expiresInDays }).then((d) => d.invite)
export const cancelInvite = (code) => apiFetch(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })

// Admins (owner only)

export const listAdmins = () => apiFetch('/admin/admins').then((d) => d.admins)
export const addAdmin = ({ name, email }) => post('/admin/admins', { name, email })
export const newSetupLink = (id) => post(`/admin/admins/${id}/setup-link`).then((d) => d.setupLink)
export const switchAdmin = (id, on) => post(`/admin/admins/${id}/switch-${on ? 'on' : 'off'}`).then((d) => d.admin)

// Activity

export function listActivity({ before, adminId, action } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  if (adminId) params.set('adminId', adminId)
  if (action) params.set('action', action)
  const qs = params.toString()
  return apiFetch(`/admin/activity${qs ? `?${qs}` : ''}`)
}

export const activityFilters = () => apiFetch('/admin/activity/filters')
