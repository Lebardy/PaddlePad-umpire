// The 3rd shot of the rally being played. Kept free of imports so the
// check script can load it straight into node.

/** The latest 3rd shot logged since the last rally: the one the next rally links to. */
export function waitingThirdShot(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'rally') return null
    if (events[i].type === 'thirdShot') return events[i]
  }
  return null
}

/** Whether a 3rd-shot button is the one already logged. Old drives carry no success. */
export function isSameThirdShot(event, tap) {
  return (
    Boolean(event) &&
    event.playerId === tap.playerId &&
    event.shotType === tap.shotType &&
    (event.success ?? null) === (tap.success ?? null)
  )
}

/**
 * The log after a tap on a 3rd-shot button. The server counts every
 * thirdShot as an attempt, so a corrected tap replaces the waiting one
 * and a second tap on the same button clears it. The waiting one is
 * found wherever it sits since the last rally, so a serve correction
 * logged after it does not leave it behind. Only that one event is ever
 * removed.
 */
export function withThirdShotTap(events, tap, { id, at }) {
  const waiting = waitingThirdShot(events)
  const kept = waiting ? events.filter((e) => e !== waiting) : events
  if (waiting && isSameThirdShot(waiting, tap)) return kept
  return [
    ...kept,
    { type: 'thirdShot', id, at, playerId: tap.playerId, shotType: tap.shotType, success: tap.success },
  ]
}
