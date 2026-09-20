// ============================================================
// The Overview's rules, with no database: which matches are worth a
// look, which players might be one person entered twice, and when a
// void or a merge is allowed. Checked offline by
// scripts/check-overview-rules.mjs.
// ============================================================

export const WINDOW_DAYS = 30
export const STUCK_MS = 3 * 60 * 60_000
export const SHORT_MS = 3 * 60_000
export const LONG_MS = 90 * 60_000
// A session is "going on" when its last activity was within this long.
// Older than that, it's left open and belongs under Worth a look, not
// the live board.
export const ACTIVE_MS = 3 * 60 * 60_000
export const REASONS = ['stuck', 'ended_early', 'shutout', 'short', 'long']
// Where an event names a player: a rally's acting player, and the
// player of a third shot or a serve correction (see pickleball.js).
export const PLAYER_ID_KEYS = ['actingPlayerId', 'playerId']
export const VOID_REASON_MAX = 300

export const NOT_FLAGGED_MESSAGE = "That match isn't flagged, so it can't be voided here"
export const VOID_REASON_MESSAGE = "Say why you're voiding this match (up to 300 characters)"
export const NOT_OVERVIEW_VOID_MESSAGE = 'Only a match voided from the Overview can be undone here'
export const NOT_LEFT_OPEN_MESSAGE = "That session isn't left open, so it can't be closed here"
export const SESSION_REASON_MESSAGE = "Say why you're closing this session (up to 300 characters)"
export const BOTH_SIGNED_IN_MESSAGE = "Both have signed in to the player app, so they can't be merged"
export const KEEP_SIGNED_IN_MESSAGE = 'Keep the one who has signed in to the player app'
export const SHARED_MATCH_MESSAGE = "These two have played in the same match, so they're two different people"
export const LIVE_SESSION_MESSAGE = 'Try again once their session has ended'
export const CONFIRM_MERGE_MESSAGE = 'Type the name of the player being removed to confirm'
export const CLOSED_MERGE_MESSAGE = "Closed accounts can't be merged"
export const SAME_PLAYER_MESSAGE = 'Pick two different players'

const ms = (value) => (value == null ? null : typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "under a minute", "2 minutes", "4 hours", "1 h 40 min". */
export function durationText(duration) {
  const minutes = Math.floor(duration / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return plural(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? plural(hours, 'hour') : `${hours} h ${rest} min`
}

/** "under a minute" .. "23 hours", then whole days: "1 day", "17 days". */
export function openForText(duration) {
  const DAY = 24 * 60 * 60_000
  if (duration < DAY) return durationText(duration)
  return plural(Math.floor(duration / DAY), 'day')
}

/**
 * Why a match is worth a look, in a fixed order, each with the words
 * shown on its tag. An empty list means nothing is odd about it.
 */
export function matchReasons(match, now) {
  const reasons = []
  const started = ms(match.startedAt)
  const ended = ms(match.endedAt)
  const { A, B } = match.score ?? { A: 0, B: 0 }

  if (match.status === 'in_progress' && started != null && now - started > STUCK_MS) {
    reasons.push({ reason: 'stuck', tag: `In progress for ${durationText(now - started)}` })
  }
  if (match.status === 'completed' && match.endedEarly) {
    reasons.push({ reason: 'ended_early', tag: `Ended early at ${A}–${B}` })
  }
  if (match.status === 'completed' && !match.endedEarly && Math.min(A, B) === 0 && Math.max(A, B) > 0) {
    reasons.push({ reason: 'shutout', tag: `Ended ${Math.max(A, B)}–0` })
  }
  if (match.status === 'completed' && started != null && ended != null) {
    const took = ended - started
    if (took < SHORT_MS) reasons.push({ reason: 'short', tag: `Lasted ${durationText(took)}` })
    if (took > LONG_MS) reasons.push({ reason: 'long', tag: `Lasted ${durationText(took)}` })
  }
  return reasons
}

/**
 * Null while a session counts as going on -- its last activity (open,
 * or a non-voided match starting or ending) was within ACTIVE_MS.
 * Otherwise the reason it belongs under Worth a look instead, with how
 * long it's been open, measured from when it was opened (not from the
 * last activity). `session` is `{ openedAt, lastActivityAt }`.
 */
export function leftOpenReason(session, now) {
  const lastActivity = ms(session.lastActivityAt)
  if (lastActivity != null && now - lastActivity <= ACTIVE_MS) return null
  const openedAt = ms(session.openedAt)
  return { reason: 'left_open', tag: `Left open for ${openForText(now - openedAt)}` }
}

export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** How many single-letter changes turn one text into the other. */
export function letterDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

const hasDigit = (text) => /\d/.test(text)
const typoText = (distance) => (distance === 1 ? 'Names differ by one letter' : distance === 2 ? 'Names differ by two letters' : null)

/**
 * Same word count: compare word against word by position and add up
 * the letter distance over only the words that differ. A digit in
 * either side of a differing word rules it out ("Demo 01" / "Demo
 * 05"). A short differing word (its shorter side 4 letters or fewer)
 * only counts at exactly 1 letter, and when the whole name is a
 * single word, that one letter must also keep the same length ("Jan"
 * / "Jana" left alone, "Jon" / "Jan" flagged).
 */
function wordByWordDistance(wordsA, wordsB) {
  let total = 0
  for (let i = 0; i < wordsA.length; i += 1) {
    const wa = wordsA[i]
    const wb = wordsB[i]
    if (wa === wb) continue
    if (hasDigit(wa) || hasDigit(wb)) return null
    const distance = letterDistance(wa, wb)
    if (Math.min(wa.length, wb.length) <= 4) {
      if (distance !== 1) return null
      if (wordsA.length === 1 && wa.length !== wb.length) return null
    }
    total += distance
  }
  return total
}

/**
 * Different word counts: the whole-name letter distance, unchanged
 * from before -- except a name of 4 letters or fewer is never flagged
 * this way, and a digit anywhere in either name rules it out.
 */
function wholeNameDistance(a, b, shorter, longer) {
  if (shorter.length <= 4) return null
  if (longer.length - shorter.length > 2) return null
  if (hasDigit(a) || hasDigit(b)) return null
  return letterDistance(a, b)
}

/**
 * Why two names might be one person, or null.
 */
export function nameReason(nameA, nameB) {
  const a = normalizeName(nameA)
  const b = normalizeName(nameB)
  if (!a || !b) return null
  if (a === b) return { reason: 'typo', text: 'Names differ only in capitals or spaces' }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (longer.startsWith(shorter) && longer[shorter.length] === ' ') {
    return { reason: 'short_name', text: 'One name is the start of the other' }
  }
  const wordsA = a.split(' ')
  const wordsB = b.split(' ')
  const distance = wordsA.length === wordsB.length
    ? wordByWordDistance(wordsA, wordsB)
    : wholeNameDistance(a, b, shorter, longer)
  const text = distance == null ? null : typoText(distance)
  return text ? { reason: 'typo', text } : null
}

export function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** Every pair of players who have been on court in the same match. */
export function sharedMatchPairs(matches) {
  const pairs = new Set()
  for (const match of matches) {
    const everyone = [...match.teamA, ...match.teamB]
    for (let i = 0; i < everyone.length; i += 1) {
      for (let j = i + 1; j < everyone.length; j += 1) pairs.add(pairKey(everyone[i], everyone[j]))
    }
  }
  return pairs
}

/**
 * Two players on one session's list who played with exactly the same
 * partners there -- at least two of them -- and were never on court
 * together: the sign of one person added twice. Sharing a single
 * partner happens all the time on a rotation night, so it doesn't
 * count; players with no partners (singles only, or no matches) are
 * never paired this way.
 */
export function sameDayPairs(sessions) {
  const pairs = new Set()
  for (const session of sessions) {
    const partners = new Map()
    const together = sharedMatchPairs(session.matches)
    for (const match of session.matches) {
      for (const team of [match.teamA, match.teamB]) {
        for (const player of team) {
          if (!partners.has(player)) partners.set(player, new Set())
          for (const other of team) if (other !== player) partners.get(player).add(other)
        }
      }
    }
    const listed = session.playerIds.filter((id) => partners.get(id)?.size >= 2)
    for (let i = 0; i < listed.length; i += 1) {
      for (let j = i + 1; j < listed.length; j += 1) {
        const [a, b] = [listed[i], listed[j]]
        if (together.has(pairKey(a, b))) continue
        const pa = [...partners.get(a)].sort().join(',')
        const pb = [...partners.get(b)].sort().join(',')
        if (pa === pb) pairs.add(pairKey(a, b))
      }
    }
  }
  return pairs
}

/**
 * Every pair worth the owner's look, each once, ordered by the first
 * player's position in `players`. Name reasons win over the same-day
 * reason when both apply.
 */
export function duplicatePairs(players, { sharedPairs, sameDay, dismissed }) {
  const found = []
  const byId = new Map(players.map((p) => [p.id, p]))
  const seen = new Set()
  const add = (a, b, reason, text) => {
    const key = pairKey(a.id, b.id)
    if (seen.has(key) || sharedPairs.has(key) || dismissed.has(key)) return
    seen.add(key)
    const [first, second] = a.id < b.id ? [a, b] : [b, a]
    found.push({ a: first.id, b: second.id, reason, text })
  }
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const why = nameReason(players[i].name, players[j].name)
      if (why) add(players[i], players[j], why.reason, why.text)
    }
  }
  for (const key of sameDay) {
    const [a, b] = key.split(':')
    if (byId.has(a) && byId.has(b)) add(byId.get(a), byId.get(b), 'same_day', 'Same session, same partners, never played each other')
  }
  return found
}

/** Whether a player row has any way to sign in to the player app. */
export function hasSignIn(row) {
  return Boolean(row.username || row.password_hash || row.google_sub || row.claimed_at || row.registered_at)
}

/** Why two players can't be merged right now, or null when they can. */
export function mergeRefusal({ keep, remove, sharedMatch, removeInLiveSession }) {
  if (keep.id === remove.id) return SAME_PLAYER_MESSAGE
  if (keep.closed || remove.closed) return CLOSED_MERGE_MESSAGE
  if (keep.hasSignIn && remove.hasSignIn) return BOTH_SIGNED_IN_MESSAGE
  if (remove.hasSignIn) return KEEP_SIGNED_IN_MESSAGE
  if (sharedMatch) return SHARED_MATCH_MESSAGE
  if (removeInLiveSession) return LIVE_SESSION_MESSAGE
  return null
}

/**
 * A 1-300 character reason, trimmed -- shared by Void and Close a
 * session, which differ only in what they say when it's missing.
 */
export function readVoidReason(value, message = VOID_REASON_MESSAGE) {
  const reason = String(value ?? '').trim()
  if (!reason || reason.length > VOID_REASON_MAX) return { error: message }
  return { reason }
}
