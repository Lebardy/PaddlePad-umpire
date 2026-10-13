// ============================================================
// A filming phone's own small decisions, kept apart from the camera so
// they can be checked without one. (videoClock.js holds the ones the
// umpire app's camera makes too; that file is a copy and stays as it is.)
// ============================================================

const DEVICE_KEY = 'paddlepad.player.device'
/** A phone that is told someone else is filming asks again this often, in case their phone has gone quiet. */
export const CLAIM_AGAIN_MS = 10_000

let unsaved = null

/** This phone's own name for itself, so the server can tell two phones on one account apart. */
export function getDeviceId() {
  try {
    const kept = localStorage.getItem(DEVICE_KEY)
    if (kept) return kept
    const made = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, made)
    return made
  } catch {
    // Private mode: one name for as long as this page lives.
    unsaved ??= crypto.randomUUID()
    return unsaved
  }
}

/**
 * What a refused claim leaves behind: who is filming `matchId` instead,
 * or null when the refusal names nobody (the match is gone, or the
 * connection dropped).
 */
export function coveredFrom(error, matchId, now) {
  return coveredBy(error?.details?.covered, matchId, now)
}

/** The same, from the answer itself: `covered` is { by, name }, or nothing. */
export function coveredBy(covered, matchId, now) {
  if (!covered) return null
  return { matchId, by: covered.by, name: covered.name, againAt: now + CLAIM_AGAIN_MS }
}

/** Whether to ask for this match now. One the facility films is not asked for again. */
export function mayClaim(covered, matchId, now) {
  if (!covered || covered.matchId !== matchId) return true
  return covered.by === 'player' && now >= covered.againAt
}
