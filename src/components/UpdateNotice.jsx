import { useSyncExternalStore } from 'react'
import { applyPendingUpdate, isUpdateReady, subscribeUpdate } from '../lib/pwa'

/**
 * "Update ready" pill. Appears only when a new version is waiting, and
 * applies it only when tapped -- never mid-rally on its own.
 */
function UpdateNotice() {
  const ready = useSyncExternalStore(subscribeUpdate, isUpdateReady)
  if (!ready) return null

  return (
    <button className="update-pill" onClick={applyPendingUpdate}>
      Update ready — tap to apply
    </button>
  )
}

export default UpdateNotice
