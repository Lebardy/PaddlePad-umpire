// ============================================================
// Which device has the say over a match.
//
// A tablet saves a match by sending every tap it has, and the server
// keeps the newest list. That is only safe while one device at a time
// may do it.
// ============================================================

// How long a device keeps the right to score a match before another
// may take over without forcing.
//
// Handover mid-session is the NORMAL case -- one umpire relieves
// another on a court -- so the lease has to expire. Without it, a
// phone put in a pocket or one that crashed would lock that court
// forever with no way back except a database edit.
export const LEASE_MINUTES = 15

/**
 * Whether a device other than `deviceId` has the say over this match
 * right now. `match` is the database row.
 *
 * While a match is being played, that is whoever saved it in the last
 * LEASE_MINUTES. A FINISHED match stays with the device that finished
 * it: a tablet that comes back online with an older list of taps must
 * not undo a result. Taking over on purpose (POST /matches/:id/claim)
 * changes the device, so that still works.
 */
export function heldByAnotherDevice(match, deviceId, now = Date.now()) {
  if (!match.scoring_device || match.scoring_device === deviceId) return false
  if (match.status === 'completed') return true
  return now - new Date(match.scoring_claimed_at).getTime() < LEASE_MINUTES * 60_000
}
