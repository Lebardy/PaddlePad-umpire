import { statusLabel } from '../lib/format'

/** A status, as a small lamp and its word: a person's active, paused or closed; an open play's open or full. */
export default function StatusTag({ status }) {
  return <span className={`status-tag status-${status}`}>{statusLabel(status)}</span>
}
