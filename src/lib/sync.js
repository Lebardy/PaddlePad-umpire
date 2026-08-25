import { ApiError, getToken } from './api'
import * as api from './api'
import * as outbox from './outbox'
import { subscribe } from './localstore'
import { getSession, getMatch, replaceServerState } from './storage'

// ============================================================
// Sync -- moves data between this device and the server.
//
// Pull is straightforward. Push is where the care is: see outbox.js for
// why entries carry pointers rather than payloads.
//
// FAILURE CLASSIFICATION IS THE WHOLE GAME. Getting this table wrong is
// how sync layers rot -- either one bad request freezes the queue
// forever, or a genuine failure gets silently dropped and an umpire's
// match quietly never arrives.
//
//   network / 5xx / 429  transient  -> keep at the head, back off
//   401                  auth       -> pause everything, prompt, drop nothing
//   409 on a match log   blocked    -> another device is scoring; ask
//   other 4xx            permanent  -> dead-letter, KEEP DRAINING
//
// Head-of-line blocking is correct for transient errors, because order
// is a correctness requirement (a match must exist before its events).
// It is deliberately broken for permanent ones, because otherwise a
// single poison entry stops the app syncing for good.
// ============================================================

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000]
const DEBOUNCE_MS = 2_000
const HEARTBEAT_MS = 30_000

let draining = null
let debounceTimer = null
let heartbeatTimer = null

// Whether the server actually answered us last time.
//
// navigator.onLine is NOT used for this. It reports whether a network
// interface exists, which is true on captive-portal court wifi -- the
// exact failure this app has to survive. Only a real request outcome
// tells the truth.
let reachable = true
let authPaused = false

const statusListeners = new Set()

export function subscribeStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function notify() {
  for (const listener of statusListeners) listener()
}

export function getSyncStatus() {
  return {
    pending: outbox.pendingCount(),
    dead: outbox.deadLetter().length,
    reachable,
    authPaused,
  }
}

function setReachable(value) {
  if (reachable !== value) {
    reachable = value
    notify()
  }
}

// ============================================================
// Pull
// ============================================================

/**
 * Refreshes players and sessions from the server.
 *
 * Deliberately does NOT overwrite matches that this device still owes
 * the server -- a pull must never clobber unsynced taps.
 */
export async function pullCore({ signal } = {}) {
  if (!getToken()) return
  const [players, sessions] = await Promise.all([
    api.searchPlayers('', { signal }),
    api.fetchSessions({ signal }),
  ])
  setReachable(true)
  replaceServerState({ players, sessions })
}

/**
 * Pulls one session's roster and its match list.
 *
 * Deliberately does NOT fetch each match's events. The session screen
 * only shows who played and whether the match finished, and fetching
 * full logs here was a request per match -- a slow, pointless fan-out
 * that grew with every game the club recorded. LiveMatch pulls the one
 * log it actually needs, when it needs it.
 */
export async function pullSession(sessionId, { signal } = {}) {
  if (!getToken()) return
  const [detail, matches] = await Promise.all([
    api.fetchSession(sessionId, { signal }),
    api.fetchMatchesForSession(sessionId, { signal }),
  ])
  setReachable(true)
  replaceServerState({ sessionDetail: detail, matches })
}

/** Pulls one match INCLUDING its event log, for the scoring screen. */
export async function pullMatch(matchId, { signal } = {}) {
  if (!getToken()) return
  const match = await api.fetchMatch(matchId, { signal })
  setReachable(true)
  replaceServerState({ matches: [match] })
}

// ============================================================
// Push
// ============================================================

/** Reads the current local payload for an outbox entry. */
function payloadFor(entry) {
  if (entry.kind === 'session') {
    const session = getSession(entry.entityId)
    return session ? { id: session.id, name: session.name } : null
  }
  if (entry.kind === 'roster') {
    const session = getSession(entry.entityId)
    return session ? { sessionId: session.id, playerIds: session.playerIds } : null
  }
  if (entry.kind === 'match' || entry.kind === 'log') {
    return getMatch(entry.entityId)
  }
  return null
}

async function push(entry, payload) {
  if (entry.kind === 'session') {
    await api.pushSession(payload)
    return
  }
  if (entry.kind === 'roster') {
    await api.pushRoster(payload.sessionId, payload.playerIds)
    return
  }
  if (entry.kind === 'match') {
    await api.pushMatch(payload)
    return
  }
  if (entry.kind === 'log') {
    await api.pushMatchLog(payload.id, {
      deviceId: outbox.getDeviceId(),
      events: payload.events.map((event, index) => ({ ...event, seq: index })),
      endedEarly: Boolean(payload.endedEarly),
      endedEarlyAt: payload.endedAt ?? null,
    })
    return
  }
  throw new ApiError(`Unknown outbox kind: ${entry.kind}`, 400)
}

/**
 * Pushes everything owed, in order. Safe to call at any time; overlapping
 * calls share the one in-flight run rather than racing.
 */
export function drain() {
  if (draining) return draining
  draining = runDrain().finally(() => {
    draining = null
  })
  return draining
}

async function runDrain() {
  if (!getToken()) return
  if (authPaused) return

  for (const entry of outbox.pending()) {
    if (entry.state === 'blocked') continue
    if (entry.nextAttemptAt > Date.now()) break // head-of-line, deliberately

    const payload = payloadFor(entry)
    if (!payload) {
      // The entity was deleted locally; nothing left to send.
      outbox.resolve(entry.key)
      continue
    }

    try {
      await push(entry, payload)
      outbox.resolve(entry.key)
      setReachable(true)
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined

      if (status === 0 || status === 429 || (status >= 500 && status < 600)) {
        setReachable(status === 0 ? false : true)
        outbox.defer(
          entry.key,
          error.message,
          BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length - 1)],
        )
        break
      }

      if (status === 401) {
        // Never sign the umpire out mid-match over this; just stop
        // pushing until they re-authenticate. Nothing is discarded.
        authPaused = true
        notify()
        break
      }

      if (status === 409 && entry.kind === 'log') {
        outbox.block(entry.key, error.data?.heldBy ?? { unknown: true })
        continue
      }

      // Any other 4xx will never succeed by repeating. Retire it and
      // keep going rather than letting it freeze everything behind it.
      outbox.killEntry(entry.key, error.message)
    }
  }

  notify()
}

/** Forces a blocked match log through, taking the scoring lease. */
export async function takeOverMatch(matchId) {
  await api.claimMatch(matchId, { deviceId: outbox.getDeviceId(), force: true })
  outbox.markDirty('log', matchId)
  await drain()
}

export function retryDead(key) {
  outbox.reviveDead(key)
  notify()
  return drain()
}

export function discardDead(key) {
  outbox.discardDead(key)
  notify()
}

export function resumeAfterSignIn() {
  authPaused = false
  notify()
  return drain()
}

// ============================================================
// Scheduling
// ============================================================

/**
 * Requests a push soon. Debounced because taps arrive in bursts around
 * a rally, and pushing per tap would fire overlapping full-log uploads.
 */
export function scheduleDrain() {
  notify()
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => drain(), DEBOUNCE_MS)
}

/** Pushes right now -- for leaving a match, backgrounding, reconnecting. */
export function flush() {
  clearTimeout(debounceTimer)
  return drain()
}

export function init() {
  if (typeof window === 'undefined') return

  window.addEventListener('online', () => {
    setReachable(true)
    flush()
  })
  window.addEventListener('offline', () => setReachable(false))

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', () => flush())

  // Backstop, so a device that failed while backgrounded still recovers
  // without the umpire having to do anything.
  clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    if (outbox.pendingCount() > 0) drain()
  }, HEARTBEAT_MS)

  // Any local write may have queued work. Subscribing here rather than
  // having storage.js call into sync keeps the dependency one-way
  // (sync -> storage) with no import cycle.
  //
  // This fires on every local write including sync's own, which is why
  // it checks the queue first: a pull writes plenty but owes nothing,
  // so it schedules nothing and cannot feed itself.
  subscribe(() => {
    notify()
    if (outbox.pendingCount() > 0) scheduleDrain()
  })

  drain()
}
