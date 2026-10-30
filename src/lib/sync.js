import { ApiError, getToken } from './api'
import * as api from './api'
import * as outbox from './outbox'
import { subscribe } from './localstore'
import {
  getSession,
  applyCourtNotice,
  getMatch,
  getQueuedRulings,
  dropQueuedRuling,
  saveMatch,
  setScoringDevice,
  replaceServerState,
  clearTombstone,
  getTombstones,
  isTombstoned,
} from './storage'

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
//   401                  auth       -> end the session, drop nothing queued
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
// Set by a drain() call made while a run is in flight; see drain.
let drainAgain = false
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
    blocked: outbox.pending().filter((e) => e.state === 'blocked').length,
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

// Every successful push or takeover adopt, numbered, and the number of each
// entity's latest one. A pull notes the number before it asks; anything
// that made the server's copy newer after that is newer here than in the
// pull's answer. Per tab: another tab's push is not seen (the app open
// twice is rare).
let pushes = 0
const lastPushed = new Map()

function pushedSince(since) {
  return new Set([...lastPushed].filter(([, n]) => n > since).map(([id]) => id))
}

/**
 * Refreshes players and sessions from the server.
 *
 * Deliberately does NOT overwrite matches that this device still owes
 * the server -- a pull must never clobber unsynced taps.
 */
export async function pullCore({ signal } = {}) {
  if (!getToken()) return
  const since = pushes
  const [players, sessions] = await Promise.all([
    api.searchPlayers('', { signal }),
    api.fetchSessions({ signal }),
  ])
  setReachable(true)
  replaceServerState({ players, sessions, keep: pushedSince(since) })
}

/**
 * Pulls one session's roster and its match list.
 *
 * Deliberately does NOT fetch each match's events. The session screen
 * only shows who played and whether the match finished, and fetching
 * full logs here was a request per match -- a slow, pointless fan-out
 * that grew with every game recorded. LiveMatch pulls the one
 * log it actually needs, when it needs it.
 */
export async function pullSession(sessionId, { signal } = {}) {
  if (!getToken()) return
  const since = pushes
  const [detail, matches] = await Promise.all([
    api.fetchSession(sessionId, { signal }),
    api.fetchMatchesForSession(sessionId, { signal }),
  ])
  setReachable(true)
  replaceServerState({ sessionDetail: detail, matches, keep: pushedSince(since) })
}

/** Pulls one match INCLUDING its event log, for the scoring screen. */
export async function pullMatch(matchId, { signal } = {}) {
  if (!getToken()) return
  const since = pushes
  const match = await api.fetchMatch(matchId, { signal })
  setReachable(true)
  replaceServerState({ matches: [match], keep: pushedSince(since) })
}

// ============================================================
// Push
// ============================================================

/** Reads the current local payload for an outbox entry. */
function payloadFor(entry) {
  if (entry.kind === 'session') {
    const session = getSession(entry.entityId)
    return session ? {
      id: session.id,
      name: session.name,
      // Undefined for a session made before this update, so it goes up the old way.
      startsAt: session.startsAt ? new Date(session.startsAt).toISOString() : undefined,
      openPlayId: session.openPlayId ?? undefined,
      court: session.court ?? undefined,
    } : null
  }
  if (entry.kind === 'sessionVoid' || entry.kind === 'sessionEnd') {
    return getSession(entry.entityId)
  }
  if (entry.kind === 'roster') {
    const session = getSession(entry.entityId)
    return session ? { sessionId: session.id, playerIds: session.playerIds } : null
  }
  if (entry.kind === 'match' || entry.kind === 'log' || entry.kind === 'matchVoid') {
    return getMatch(entry.entityId)
  }
  if (entry.kind === 'scorekeeper') return getMatch(entry.entityId)
  if (entry.kind === 'ruling') return getQueuedRulings().find((r) => r.id === entry.entityId) ?? null
  // Deletes have no local record left to read -- the tombstone IS the
  // payload. Without this they would look like a vanished entity and be
  // dropped from the queue, leaving the row alive on the server.
  if (entry.kind === 'matchDelete') {
    return isTombstoned('matches', entry.entityId) ? { id: entry.entityId } : null
  }
  if (entry.kind === 'sessionDelete') {
    return isTombstoned('sessions', entry.entityId) ? { id: entry.entityId } : null
  }
  return null
}

async function push(entry, payload) {
  if (entry.kind === 'session') {
    const { session, courtNotice } = await api.pushSession(payload)
    // The court was taken or not this umpire's: the server kept it as a plain session.
    if (courtNotice) applyCourtNotice(payload.id, { name: session.name, notice: courtNotice })
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
  if (entry.kind === 'scorekeeper') {
    const scorekeeper = await api.setScorekeeper(payload.id, {
      umpireId: payload.scorekeeperAsk?.umpireId ?? null,
      deviceId: outbox.getDeviceId(),
    })
    const match = getMatch(payload.id)
    if (match) saveMatch({ ...match, scorekeeper, scorekeeperAsk: undefined })
    return
  }
  if (entry.kind === 'ruling') {
    try {
      await api.sendRuling(payload.matchId, payload)
    } catch (error) {
      // Refused (too late, or the split ended): the server kept it as
      // refused and the next read of the match shows why. Not a failure.
      if (error.status !== 409) throw error
    }
    dropQueuedRuling(payload.id)
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
  if (entry.kind === 'sessionVoid') {
    await api.setSessionVoided(payload.id, {
      voided: Boolean(payload.voidedAt),
      reason: payload.voidReason ?? '',
    })
    return
  }
  if (entry.kind === 'sessionEnd') {
    await api.setSessionEnded(payload.id, { ended: Boolean(payload.endedAt) })
    return
  }
  if (entry.kind === 'matchVoid') {
    await api.setMatchVoided(payload.id, {
      voided: Boolean(payload.voidedAt),
      reason: payload.voidReason ?? '',
    })
    return
  }
  if (entry.kind === 'matchDelete') {
    await api.deleteMatchOnServer(payload.id, { deviceId: outbox.getDeviceId() })
    clearTombstone('matches', payload.id)
    return
  }
  if (entry.kind === 'sessionDelete') {
    await api.deleteSessionOnServer(payload.id, { deviceId: outbox.getDeviceId() })
    clearTombstone('sessions', payload.id)
    return
  }
  throw new ApiError(`Unknown outbox kind: ${entry.kind}`, 400)
}

/**
 * Pushes everything owed, in order. Safe to call at any time; overlapping
 * calls never race, they share one in-flight chain of runs. A call made
 * while a run is in flight asks for one more run after it, because that
 * run may have read its payloads before the change that prompted the
 * call. The returned promise covers that extra run too.
 */
export function drain() {
  if (draining) {
    drainAgain = true
    return draining
  }
  // draining is cleared in the same synchronous step as the last
  // drainAgain check, so a drain() call cannot land between the two and
  // get a promise that is about to settle with no run behind it.
  draining = (async () => {
    try {
      do {
        drainAgain = false
        await runDrain()
      } while (drainAgain)
    } finally {
      draining = null
    }
  })()
  return draining
}

async function runDrain() {
  if (!getToken()) return
  if (authPaused) return

  for (const entry of outbox.pending()) {
    if (entry.state === 'blocked') continue
    if (entry.nextAttemptAt > Date.now()) break // head-of-line, deliberately

    // Read before the payload, with nothing awaited in between, so a tap
    // made during the push below bumps the mark and is not retired with it.
    const mark = outbox.currentMark(entry.key)
    const payload = payloadFor(entry)
    if (!payload) {
      // The entity was deleted locally; nothing left to send.
      outbox.resolve(entry.key)
      continue
    }

    try {
      await push(entry, payload)
      outbox.resolve(entry.key, mark)
      lastPushed.set(entry.entityId, ++pushes)
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
        // api.js has already cleared the session and told App.jsx to
        // drop the stored umpire (see subscribeSessionEnded there) --
        // this only needs to stop the queue so nothing here keeps
        // retrying against a token that is already gone. Nothing
        // queued is discarded; it is still in the outbox for whoever
        // signs back in, and resumeAfterSignIn (called from App.jsx's
        // umpire effect) drains it once they do.
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

/**
 * Compares two event logs by id, position by position.
 *
 * Event ids are minted once, on the device that recorded the tap, and
 * never change -- so the shared prefix tells us exactly how the two
 * logs relate rather than making us guess from counts.
 *
 *   'same'        identical
 *   'server-ahead' this device's log is a prefix of the server's, so
 *                  this device is simply behind (it was watching, not
 *                  scoring)
 *   'local-ahead'  the server's log is a prefix of this device's, so
 *                  this device holds taps the server never received
 *   'diverged'     both contain taps the other lacks -- a genuine
 *                  double-scoring conflict
 */
export function compareLogs(local, remote) {
  const shared = Math.min(local.length, remote.length)
  for (let i = 0; i < shared; i += 1) {
    if (local[i]?.id !== remote[i]?.id) return 'diverged'
  }
  if (local.length === remote.length) return 'same'
  return local.length < remote.length ? 'server-ahead' : 'local-ahead'
}

/**
 * Takes over scoring a match.
 *
 * The first version of this simply forced the local log up, on the
 * reasoning that two umpires scoring one match are producing rival
 * opinions and one has to win. That was wrong about the situation that
 * actually occurs.
 *
 * In practice the second device is not scoring at all -- it has the
 * match open and is watching a copy that has fallen behind. Its log is
 * not a rival opinion, it is simply OLDER, and pushing it deleted the
 * real scoring. That is what "take over and the score went backwards"
 * was.
 *
 * So takeover claims the match first, then reads the server and works
 * out how the two logs actually relate. Claiming first matters: once
 * the claim lands the other device's saves are refused, so what is read
 * afterwards is final (reading first lost a rally the other device saved
 * in between). A save already being written when the claim lands may
 * still land and take the lease back; this device's next tap then blocks
 * and the umpire is asked again, so nothing is lost.
 *
 *   behind      adopt the server's log and carry on from there -- which
 *               is what "take over scoring" means in plain English
 *   ahead       this device really does hold unsent taps; push them
 *   diverged    both sides recorded different rallies. Nothing is
 *               thrown away silently: the counts are handed back so the
 *               umpire can choose. This device holds the lease while
 *               they choose, so the other device's taps block meanwhile.
 *
 * The log stays blocked while the umpire is being asked (taps included),
 * so nothing is pushed over the other device's rallies until they answer.
 * A tap made while the claim was on its way is read like any other, and
 * an earlier choice no longer applies to it, since it was about the logs
 * before that tap. The same goes when the server's log has moved on from
 * the one the prompt showed (`remoteLast`, the id of its last event: a
 * log that was undone and tapped again has a new one, where a count
 * would match).
 *
 * @param {string} matchId
 * @param {object} [options]
 * @param {'server'|'mine'} [options.resolution] choice for a diverged log
 * @param {string|null} [options.remoteLast] last server event id the choice was made against
 */
export async function takeOverMatch(matchId, { resolution, remoteLast } = {}) {
  const deviceId = outbox.getDeviceId()

  const before = getMatch(matchId)
  await api.claimMatch(matchId, { deviceId, force: true })
  const remote = await api.fetchMatch(matchId)
  setReachable(true)

  const local = getMatch(matchId)
  const localEvents = local?.events ?? []
  const remoteEvents = remote.events ?? []
  const last = remoteEvents.at(-1)?.id ?? null
  const choice = local === before && (remoteLast === undefined || remoteLast === last) ? resolution : undefined
  const relation = compareLogs(localEvents, remoteEvents)

  const adoptServer = () => {
    // A void made here and not yet sent is the umpire's latest word on it;
    // the queued push sends it, so the adopted copy must not undo it.
    const voidQueued = outbox.pending().some((e) => e.kind === 'matchVoid' && e.entityId === matchId)
    const adopted = {
      ...remote,
      scoringDevice: deviceId,
      ...(voidQueued && local
        ? { voidedAt: local.voidedAt ?? null, voidReason: local.voidReason ?? null }
        : {}),
    }
    // force, because this match is in the outbox and a normal merge
    // deliberately refuses to overwrite queued work.
    replaceServerState({ matches: [adopted], force: true })
    outbox.resolve(outbox.outboxKey('log', matchId))
    // The umpire chose the server's log, so a refused copy of theirs in the
    // couldn't-sync list no longer describes anything; left there it would
    // freeze this match against pulls and "Try again" would send it stale.
    outbox.discardDead(outbox.outboxKey('log', matchId))
    lastPushed.set(matchId, ++pushes)
    notify()
    return { status: 'adopted', events: remoteEvents.length }
  }

  const pushMine = async () => {
    setScoringDevice(matchId, deviceId) // the claim made this device the scorer
    outbox.markDirty('log', matchId)
    outbox.release(outbox.outboxKey('log', matchId))
    await drain()
    return { status: 'pushed', events: localEvents.length }
  }

  if (relation === 'diverged') {
    if (choice === 'server') return adoptServer()
    if (choice === 'mine') return pushMine()
    return {
      status: 'conflict',
      localCount: localEvents.length,
      remoteCount: remoteEvents.length,
      remoteLast: last,
    }
  }

  if (relation === 'local-ahead') return pushMine()
  return adoptServer()
}

export function retryDead(key) {
  outbox.reviveDead(key)
  notify()
  return drain()
}

export function discardDead(key) {
  outbox.discardDead(key)
  // A refused cancel is given up: the record stays, so bring it back here.
  const [kind, id] = key.split(':')
  if (kind === 'matchDelete') {
    clearTombstone('matches', id)
    pullMatch(id).catch(() => {})
  } else if (kind === 'sessionDelete') {
    const buried = getTombstones().sessionMatches?.[id] ?? []
    clearTombstone('sessions', id)
    // Deleting a session also buried its matches; the ones with no delete
    // of their own still queued come back with it, even if the pulls
    // below fail (any later pull then restores them).
    const owed = new Set([...outbox.pending(), ...outbox.deadLetter()].map((e) => e.key))
    for (const matchId of buried) {
      if (!owed.has(outbox.outboxKey('matchDelete', matchId))) clearTombstone('matches', matchId)
    }
    pullCore().then(() => pullSession(id)).catch(() => {})
  }
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
