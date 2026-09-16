import { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'

/**
 * Shows a freshly made claim code once, the same moment it comes back
 * from the server. It is never stored and never shown again after this
 * page is left, so this is the admin's only chance to hand it over.
 */
export default function ClaimCodeReveal({ code, playerName }) {
  const [copied, setCopied] = useState(false)

  // Type 0 lets the library pick the smallest QR version that fits; 'M'
  // error correction survives a slightly dirty or angled phone screen --
  // the same choice the umpire app makes for a player's own claim code.
  const qrSrc = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(code)
    qr.make()
    return qr.createDataURL(5)
  }, [code])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The code stays on screen to copy by hand.
    }
  }

  return (
    <div className="ticket board-texture claim-reveal" role="status">
      <div>
        <p className="ticket-label">New claim code for {playerName}</p>
        <p className="ticket-code">{code}</p>
        <p className="ticket-text">Give this to the player. It won’t be shown again once you leave this page.</p>
      </div>
      <div className="claim-reveal-side">
        <img className="qr" src={qrSrc} alt={`QR code for claim code ${code}`} width={168} height={168} />
        <button type="button" className="btn-lamp" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  )
}
