import { useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import { fetchPlayerClaimCode } from '../lib/api'

// Where the player app lives. Build-time, like the API URL, so a
// production build points at the deployed player app rather than a
// developer's laptop.
const PLAYER_APP_URL = (
  import.meta.env?.VITE_PLAYER_APP_URL ?? 'https://paddlepad-play.up.railway.app'
).replace(/\/$/, '')

/**
 * Renders a claim URL as an inline SVG QR.
 *
 * The QR encodes a URL rather than the bare code, so a player just
 * points their phone camera at it and the claim page opens with the
 * code already filled -- no app to install first and nothing to type.
 * That also means this app needs no camera permission or scanner.
 */
function QrSvg({ text, size = 168 }) {
  // Type 0 lets the library pick the smallest version that fits; 'M'
  // error correction survives a slightly dirty or angled phone screen.
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()

  const count = qr.getModuleCount()
  const cell = size / count

  const squares = []
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        squares.push(
          <rect
            key={`${row}-${col}`}
            x={col * cell}
            y={row * cell}
            width={cell}
            height={cell}
          />,
        )
      }
    }
  }

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code linking to the player app"
    >
      {/* An explicit white ground, because a dark-mode background behind
          a transparent QR makes it unscannable. */}
      <rect width={size} height={size} fill="#ffffff" />
      <g fill="#000000">{squares}</g>
    </svg>
  )
}

/**
 * Shows one player the code that lets them see their own matches.
 *
 * Without this nothing surfaces a claim code at all, so the player app
 * would have no way in.
 */
function PlayerCodeCard({ player, onClose }) {
  const [code, setCode] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchPlayerClaimCode(player.id)
      .then((value) => {
        if (!controller.signal.aborted) setCode(value)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message)
      })
    return () => controller.abort()
  }, [player.id])

  const url = code ? `${PLAYER_APP_URL}/claim/${code}` : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy blocked — read the code out instead.')
    }
  }

  return (
    <div className="code-card">
      <div className="code-card-head">
        <h4>{player.name}</h4>
        <button className="link-button" onClick={onClose}>
          Close
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
      {!code && !error && <p className="empty">Getting their code…</p>}

      {code && (
        <>
          <p className="code-help">
            Have them scan this, or type the code at{' '}
            <strong>{PLAYER_APP_URL.replace('https://', '')}</strong>
          </p>
          <div className="qr-wrap">
            <QrSvg text={url} />
          </div>
          <p className="invite-code code-large">{code}</p>
          <button className="export-btn" onClick={copy}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </>
      )}
    </div>
  )
}

export default PlayerCodeCard
