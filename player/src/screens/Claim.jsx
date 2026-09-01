import { useEffect, useState } from 'react'
import { claim } from '../lib/api'
import { claimCodeFromUrl } from '../lib/router'

/**
 * Where a player enters the code their umpire gave them.
 *
 * One of the panels in SignIn, and the FAST way in: no name to pick, no
 * password to invent. That speed is deliberate -- the data is a person's
 * own pickleball stats, and a signup form at the moment someone is
 * handed a QR courtside is exactly the friction that leaves records
 * unclaimed and this app pointless.
 *
 * It is no longer the ONLY way in. A player can create a proper account
 * instead, or add one afterwards from their profile. This panel stays
 * because a code takes three seconds and an account does not.
 *
 * Prefilled from /claim/CODE so a QR lands straight here with the field
 * already filled and nothing to type.
 */
function Claim({ onClaimed }) {
  // Derived when state is first created rather than set from an effect,
  // which would render once with an empty field and then again with the
  // code -- visible as a flicker on the one screen that must feel like
  // it just worked.
  const [code, setCode] = useState(claimCodeFromUrl)
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
    <form onSubmit={handleSubmit}>
      <label htmlFor="code">Your code</label>
      <input
        id="code"
        className="code-input"
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
        scan. You can set up a username and password afterwards.
      </p>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy || !code.trim()}>
        {busy ? 'Checking…' : 'See my matches'}
      </button>
    </form>
  )
}

export default Claim
