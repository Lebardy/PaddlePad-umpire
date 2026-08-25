import { useState } from 'react'
import { pending } from '../lib/outbox'
import { takeOverMatch } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'

/**
 * Shown when this device's taps for a match are blocked because another
 * device holds the scoring lease.
 *
 * Taking over reads the server first and works out how the two logs
 * relate, rather than assuming this device's copy should win. In almost
 * every real case this device was only WATCHING and has fallen behind,
 * so taking over means adopting the current score and carrying on --
 * not replacing it with something older.
 *
 * The only case that needs a human is a genuine divergence, where both
 * devices recorded rallies the other never saw. Then the umpire is
 * shown both counts and chooses; nothing is discarded quietly.
 */
function TakeoverNotice({ matchId }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [outcome, setOutcome] = useState(null)

  useSyncStatus()
  const blocked = pending().find(
    (entry) => entry.kind === 'log' && entry.entityId === matchId && entry.state === 'blocked',
  )

  if (!blocked && !conflict && !outcome) return null

  const holder = blocked?.lastError?.umpireName

  async function run(resolution) {
    setBusy(true)
    setError(null)
    try {
      const result = await takeOverMatch(matchId, { resolution })
      if (result.status === 'conflict') {
        setConflict(result)
      } else {
        setConflict(null)
        setOutcome(result)
        setTimeout(() => setOutcome(null), 4000)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (outcome) {
    return (
      <div className="takeover takeover--ok">
        <p className="takeover-text">
          {outcome.status === 'adopted'
            ? `You're scoring now, continuing from the current score (${outcome.events} taps).`
            : `You're scoring now. Your ${outcome.events} taps were uploaded.`}
        </p>
      </div>
    )
  }

  if (conflict) {
    return (
      <div className="takeover">
        <p className="takeover-text">
          <strong>Both devices recorded different rallies.</strong> This device
          has {conflict.localCount} taps; the server has {conflict.remoteCount}.
          One of them has to be kept — they can&rsquo;t be combined, because each
          is a different account of the same points.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="dupe-actions">
          <button className="dupe-yes" onClick={() => run('server')} disabled={busy}>
            Keep the server&rsquo;s {conflict.remoteCount}
          </button>
          <button className="dupe-no" onClick={() => run('mine')} disabled={busy}>
            Keep my {conflict.localCount}
          </button>
        </div>
      </div>
    )
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
      <button className="takeover-btn" onClick={() => run()} disabled={busy}>
        {busy ? 'Taking over…' : 'Take over scoring'}
      </button>
    </div>
  )
}

export default TakeoverNotice
