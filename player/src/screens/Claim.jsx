import { useEffect, useState } from 'react'
import { claim } from '../lib/api'

/**
 * Where a player enters the code their umpire gave them.
 *
 * The code is the whole credential -- no email, no password. That is a
 * deliberate trade: the data is a person's own pickleball stats, and an
 * extra signup step is exactly the friction that would leave records
 * unclaimed and this app pointless.
 *
 * Prefilled from /claim/CODE so a QR code lands straight here with the
 * field already filled and nothing to type.
 */
// A QR encodes the claim URL, not the raw code, so a phone's camera can
// open it directly and no scanner is needed inside this app.
function codeFromUrl() {
  const match = window.location.pathname.match(/^\/claim\/(.+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

function Claim({ onClaimed }) {
  // Derived when state is first created rather than set from an effect,
  // which would render once with an empty field and then again with the
  // code -- visible as a flicker on the one screen that must feel like
  // it just worked.
  const [code, setCode] = useState(codeFromUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Tidying the URL is a genuine side effect, so it stays in an effect.
  // Without it, a refresh would re-fill a code the player may have since
  // corrected.
  useEffect(() => {
    if (window.location.pathname.startsWith('/claim/')) {
      window.history.replaceState({}, '', '/')
    }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onClaimed(await claim(code))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="claim">
      <h1>PaddlePad</h1>
      <p className="lede">
        See the matches your umpire has been recording for you.
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="code">Your code</label>
        <input
          id="code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="PAD-7K3M-9QXR"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <p className="hint">
          Ask whoever scored your match — they can show you a code or a QR to
          scan.
        </p>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'See my matches'}
        </button>
      </form>
    </div>
  )
}

export default Claim
