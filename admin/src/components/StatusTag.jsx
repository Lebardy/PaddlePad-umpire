import { statusLabel } from '../lib/format'

/** A person's status, as a small lamp and its word: active, paused or closed. */
export default function StatusTag({ status }) {
  return <span className={`status-tag status-${status}`}>{statusLabel(status)}</span>
}
