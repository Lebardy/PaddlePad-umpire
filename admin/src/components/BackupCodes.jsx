import { useState } from 'react'

/**
 * The 10 fresh backup codes, shown once right after they're made. Never
 * fetched again -- this is the owner's only chance to save them.
 */
export default function BackupCodes({ codes, onDone }) {
  const [copied, setCopied] = useState(false)

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The codes stay on screen to copy by hand.
    }
  }

  return (
    <div className="backup-codes board-texture" role="status">
      <p className="ticket-label">Your backup codes</p>
      <ul className="backup-codes-grid">
        {codes.map((code) => <li key={code} className="code">{code}</li>)}
      </ul>
      <p className="ticket-text">Save these somewhere safe, like a password manager or on paper. Each works once. They won’t be shown again.</p>
      <div className="backup-codes-actions">
        <button type="button" className="btn-lamp" onClick={copyAll}>{copied ? 'Copied' : 'Copy all'}</button>
        <button type="button" className="btn-board" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  )
}
