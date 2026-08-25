import { useState } from 'react'
import { pending } from '../lib/outbox'
import { takeOverMatch } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'

/**
 * Shown when this device's taps for a match are blocked because another
 * device holds the scoring lease.
 *
 * Concurrent scoring is refused rather than merged. Two umpires on one
 * match are not producing complementary halves to stitch together --
 * they are producing two independent readings of the same rallies, and
 * interleaving them yields a sequence matching neither.
 *
 * So the umpire is asked, and taking over is deliberately destructive:
 * this device's log replaces what is stored. Saying that plainly is
 * better than a merge nobody could trust afterwards.
 */
function TakeoverNotice({ matchId }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Recomputed on each sync-status change, which is when a block starts
  // or clears.
  useSyncStatus()
  const blocked = pending().find(
    (entry) => entry.kind === 'log' && entry.entityId === matchId && entry.state === 'blocked',
  )

  if (!blocked) return null

  const holder = blocked.lastError?.umpireName

  async function handleTakeOver() {
    setBusy(true)
    setError(null)
    try {
      await takeOverMatch(matchId)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="takeover">
      <p className="takeover-text">
        {holder
          ? `${holder} is scoring this match on another device.`
          : 'Another device is scoring this match.'}{' '}
        Your taps are saved here but aren&rsquo;t being uploaded.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button className="takeover-btn" onClick={handleTakeOver} disabled={busy}>
        {busy ? 'Taking over…' : 'Take over scoring (replaces their log)'}
      </button>
    </div>
  )
}

export default TakeoverNotice
