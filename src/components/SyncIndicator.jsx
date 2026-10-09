import { useSyncStatus } from '../lib/useSyncStatus'
import Icon from './Icon'

/**
 * Sync state, shown only when there is something to say.
 *
 * Silence is the success signal. There are hundreds of successful syncs
 * in a session and none of them are worth a word; the only states worth
 * the umpire's attention are "your taps are safe but not uploaded yet"
 * and "something needs you".
 */
function SyncIndicator({ onOpenSync }) {
  const { pending, dead, reachable, authPaused } = useSyncStatus()

  if (dead > 0) {
    return (
      <button
        className="sync-pill sync-pill--error"
        onClick={onOpenSync}
        aria-label={`${dead} change${dead === 1 ? '' : 's'} couldn’t sync`}
      >
        <Icon name="alert" size={16} />
        {dead}
        <span className="sync-pill-words"> change{dead === 1 ? '' : 's'} couldn&rsquo;t sync</span>
      </button>
    )
  }

  if (authPaused) {
    return <span className="sync-pill sync-pill--error">Sign in again to sync</span>
  }

  if (!reachable) {
    // Reassurance, not a warning -- the taps ARE saved, just not
    // uploaded. Styled neutrally on purpose.
    return (
      <span className="sync-pill">
        Offline{pending > 0 ? ` — ${pending} saved here` : ''}
      </span>
    )
  }

  if (pending > 0) {
    return <span className="sync-pill sync-pill--quiet" title="Uploading…" />
  }

  return null
}

export default SyncIndicator
