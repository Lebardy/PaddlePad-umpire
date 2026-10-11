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

const beats = new Map()   // umpire id -> Map(device id -> { state, at })

/** `state` is what the Camera screen said it is doing: 'ready', 'filming' or 'sending'. */
export function noteBeat(umpireId, deviceId, state, now = Date.now()) {
  const phones = beats.get(umpireId) ?? new Map()
  // Forget phones gone silent, so made-up device ids cannot pile up.
  for (const [id, beat] of phones) if (now - beat.at > SILENT_AFTER_MS) phones.delete(id)
  phones.set(deviceId, { state, at: now })
  beats.set(umpireId, phones)
}

/** What the tablet's icon shows. A camera that is sending will film the next match, so it counts as ready. */
export function cameraStatus(umpireId, now = Date.now()) {
  const heard = [...(beats.get(umpireId)?.values() ?? [])].filter((beat) => now - beat.at <= SILENT_AFTER_MS)
  if (heard.length === 0) return 'none'
  return heard.some((beat) => beat.state === 'filming') ? 'filming' : 'ready'
}

export function forgetBeats() {
  beats.clear()
}
