import { registerSW } from 'virtual:pwa-register'

// ============================================================
// Service-worker updates.
//
// The app is installed to umpires' home screens, so a deploy reaches
// them through the service worker rather than a page load. Two things
// matter about how that happens:
//
//   1. It must never reload on its own. An installed app reloading
//      itself mid-rally, while someone is tapping scores, is worse
//      than running a slightly old version for another few minutes.
//   2. The umpire must be able to TELL. A silent swap leaves no way to
//      know whether a reported bug is fixed on the device in hand,
//      which is exactly the confusion this is meant to end.
//
// So: detect, announce, and let them choose the moment.
// ============================================================

let applyUpdate = () => {}
let updateReady = false
const listeners = new Set()

function notify() {
  for (const listener of listeners) listener()
}

export function subscribeUpdate(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isUpdateReady() {
  return updateReady
}

/** Applies the waiting update and reloads. Called only from a tap. */
export function applyPendingUpdate() {
  applyUpdate(true)
}

export function initPwaUpdates() {
  if (typeof window === 'undefined') return
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true
      notify()
    },
  })
}
