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
// Set when someone taps "Not now" on the sign-in setup prompt. Cleared
// with the session, so the next person to use a shared phone is still
// asked rather than inheriting a stranger's dismissal.
const SETUP_DISMISSED_KEY = 'paddlepad.player.setupDismissed'

export class ApiError extends Error {
  /**
   * `details` is the whole error body, because some refusals carry more
   * than a sentence. `needsCode` on a registration is the clearest case:
   * it is not really a failure, it is the server asking for proof, and
   * the form has to be able to tell the difference.
   */
  constructor(message, status, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
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
    localStorage.removeItem(SETUP_DISMISSED_KEY)
    // The theme (lib/theme.js) deliberately does NOT belong here. It is
    // a preference about this device, not about this account, and
    // signing out should not flip someone's phone back to light.
  } catch {
    // nothing useful to do
  }
}

/**
 * Whether the setup prompt has been waved away for this session.
 *
 * Only the POP-UP honours this. The cards on the overview and empty
 * state stay regardless, so "not now" postpones the interruption
 * without ever withdrawing the offer.
 */
export function isSetupDismissed() {
  try {
    return localStorage.getItem(SETUP_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissSetup() {
  try {
    localStorage.setItem(SETUP_DISMISSED_KEY, '1')
  } catch {
    // Private mode. It will ask again next launch, which is the better
    // way for this to fail.
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
    throw new ApiError(
      data.error ?? `Request failed (${response.status})`,
      response.status,
      data,
    )
  }
  return data
}

// ============================================================
// Getting in
//
// Three ways, all meant to exist. The claim code is the fast one -- an
// umpire hands over a QR and there is nothing to fill in. A username and
// password is the durable one, surviving a lost code and a new phone.
// Google is the one with nothing to remember at all.
//
// All of them land in the same place: a token and a player, stored the
// same way, so nothing downstream knows or cares which door was used.
// ============================================================

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

/**
 * Signs up. `code` is only needed when the name is already on the
 * roster, which the server tells us by answering with `needsCode`.
 */
export async function registerPlayer({ name, username, password, code }) {
  const data = await apiFetch('/auth/player/register', {
    method: 'POST',
    auth: false,
    body: { name, username, password, code: code || undefined },
  })
  storeSession(data.token, data.player)
  return data.player
}

/**
 * Signs in with Google.
 *
 * `name` and `code` are absent on the first call and that is the normal
 * case, not a mistake. The server answers a Google account it has never
 * seen with `needsName` -- Google proves an ACCOUNT, never which player
 * on a club roster this is -- and the screen calls this again with the
 * name typed in, and once more with a claim code if that name turns out
 * to be on the roster already.
 */
export async function googleSignIn({ accessToken, name, code }) {
  const data = await apiFetch('/auth/player/google', {
    method: 'POST',
    auth: false,
    body: { accessToken, name: name || undefined, code: code || undefined },
  })
  storeSession(data.token, data.player)
  return data.player
}

export async function loginPlayer({ username, password }) {
  const data = await apiFetch('/auth/player/login', {
    method: 'POST',
    auth: false,
    body: { username, password },
  })
  storeSession(data.token, data.player)
  return data.player
}

/**
 * Merges fields into the stored player and returns the result, so a
 * reload agrees with what is on screen.
 *
 * Every profile edit needs this, which is why it is not inlined: a
 * rename that updated React state but not localStorage would revert the
 * moment the app was reopened, and look like the save had failed.
 */
function patchStoredPlayer(fields) {
  const player = { ...(getStoredPlayer() ?? {}), ...fields }
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(player))
  } catch {
    // Private mode. State in memory is still correct for this tab.
  }
  return player
}

// ============================================================
// Your profile
// ============================================================

/**
 * Adds (or changes) sign-in details from inside the app -- the path for
 * someone who arrived by code and wants to stop depending on it, and
 * the edit path once they have.
 *
 * Only the fields passed are sent. The server takes a username change
 * without a password change and vice versa, but it wants
 * `currentPassword` for either once an account exists.
 */
export async function setCredentials({ username, password, currentPassword }) {
  const body = {}
  if (username !== undefined) body.username = username
  if (password !== undefined) body.password = password
  if (currentPassword) body.currentPassword = currentPassword

  const data = await apiFetch('/auth/player/credentials', {
    method: 'POST',
    body,
  })
  return patchStoredPlayer({ username: data.username })
}

/**
 * Connects Google to the account already signed in.
 *
 * The path most people will take, because most people arrive by
 * scanning a code and only think about getting back in days later.
 * `currentPassword` is wanted only by accounts that have a password;
 * the server asks for it with `needsCurrentPassword` rather than the
 * screen guessing.
 */
export async function linkGoogle({ accessToken, currentPassword }) {
  const body = { accessToken }
  if (currentPassword) body.currentPassword = currentPassword

  const data = await apiFetch('/auth/player/google/link', { method: 'POST', body })
  return patchStoredPlayer(data.player)
}

/** Disconnects it again. Refused if it would leave no way back in. */
export async function unlinkGoogle({ currentPassword } = {}) {
  const body = {}
  if (currentPassword) body.currentPassword = currentPassword

  const data = await apiFetch('/auth/player/google/unlink', { method: 'POST', body })
  return patchStoredPlayer(data.player)
}

/** Renames the player. The umpire's roster shows the new name too. */
export async function updateProfile({ name }) {
  const data = await apiFetch('/player/me', { method: 'PATCH', body: { name } })
  return patchStoredPlayer(data.player)
}

/**
 * Deletes the profile.
 *
 * Resolves to `{ deleted, matches }`: `deleted` is true only when the
 * record was genuinely removed, which the server allows only for a
 * player who has never appeared in a match. Otherwise the account is
 * destroyed and the match record stays. The caller reports whichever
 * came back rather than guessing from its own match count.
 *
 * The session is cleared here, unconditionally on success: whichever
 * branch ran, this token is dead.
 */
export async function deleteProfile({ password } = {}) {
  const data = await apiFetch('/player/me', {
    method: 'DELETE',
    body: { password: password || undefined },
  })
  clearSession()
  return data
}

/**
 * Attaches the record an umpire built to the account you already have.
 *
 * Called twice. Without `confirm` it is a dry run: every refusal is
 * evaluated and nothing is written, so the confirm screen can state
 * what will happen using real numbers -- `{ preview, name, theirs,
 * yours, matches }`. With it, the merge runs and the result carries the
 * merged `player`, the `matches` it now holds and the `previousName`
 * being left behind.
 *
 * Either call can come back `{ alreadyYours }` for someone entering
 * their own code, which is not a failure.
 *
 * The player id changes, which is why this stores a new session: the old
 * token names a row the server has just deleted and would be refused on
 * the very next request.
 */
export async function linkCode(code, { confirm = false } = {}) {
  const data = await apiFetch('/player/link', {
    method: 'POST',
    body: { code, confirm },
  })
  if (data.alreadyYours || data.preview) return data
  storeSession(data.token, data.player)
  return data
}

/** Profile plus headline totals. */
export function fetchMe({ signal } = {}) {
  return apiFetch('/player/me', { signal })
}

/**
 * Where this player sits in the club, and the size of their group.
 *
 * Its own call rather than part of fetchMe: the overview pays for that
 * one on every launch, and this is only wanted once somebody taps
 * through to ask.
 */
export function fetchStanding({ signal } = {}) {
  return apiFetch('/player/standing', { signal }).then((d) => d.standing)
}

/** This month on PaddlePad: the board at the top of People. */
export function fetchBoard({ signal } = {}) {
  return apiFetch('/player/board', { signal }).then((d) => d.board)
}

/**
 * How this month's match of the month went. The server answers for that
 * one match only, and never with anyone's individual shots.
 */
export function fetchBoardMatch(id, { signal } = {}) {
  return apiFetch(`/player/board/match/${encodeURIComponent(id)}`, { signal }).then((d) => d.match)
}

/**
 * Shows or hides this player's name on the monthly board. A display
 * setting only -- matches, ratings and everything else are untouched.
 */
export function setNameVisible(nameVisible) {
  return apiFetch('/player/me/visibility', {
    method: 'PUT',
    body: { nameVisible },
  }).then((d) => d.nameVisible)
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
