// ============================================================
// Each camera's last sign of life, for the scoring tablet's icon.
//
// Kept in this process's memory on purpose: it is written every 2
// seconds per camera and is worth nothing a few seconds later, so a
// database row would be all churn. One api process runs today; after a
// restart it refills within seconds. If a second process is ever added,
// this is the file to move to a shared store.
// ============================================================

const SILENT_AFTER_MS = 10_000

const beats = new Map()   // umpire id -> { state, at }

/** `state` is what the Camera screen said it is doing: 'ready', 'filming' or 'sending'. */
export function noteBeat(umpireId, state, now = Date.now()) {
  beats.set(umpireId, { state, at: now })
}

/** What the tablet's icon shows. A camera that is sending will film the next match, so it counts as ready. */
export function cameraStatus(umpireId, now = Date.now()) {
  const beat = beats.get(umpireId)
  if (!beat || now - beat.at > SILENT_AFTER_MS) return 'none'
  return beat.state === 'filming' ? 'filming' : 'ready'
}

export function forgetBeats() {
  beats.clear()
}
