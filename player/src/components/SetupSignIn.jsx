// ============================================================
// "Pick a username and password so you don't need the code again."
//
// Claim.jsx has always promised this could be done afterwards. Nothing
// ever offered it. The form existed, buried six sections down the You
// tab -- and a player who had just claimed and had no finished matches
// yet could not reach that tab at all, which made it invisible to
// exactly the person who had just been handed a code.
//
// So it is offered in two shapes here, both driven by the same fields:
//
//   SetupPrompt -- a pop-up, right after arriving. Skippable, always.
//                  A blocking form between a scanned QR and someone's
//                  stats is the precise friction Claim.jsx says leaves
//                  records unclaimed, so "Not now" is never hidden.
//   SetupCard   -- what "Not now" leaves behind. Dismissing the pop-up
//                  postpones the interruption; it does not withdraw
//                  the offer.
//
// Both matter because a player token lasts 30 days and there is no
// email, so the app has no way to let anyone back in on its own. Until
// a password exists, "ask your umpire" is the entire recovery story.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { dismissSetup, isSetupDismissed, setCredentials } from '../lib/api'
import { suggestUsername } from '../lib/username'
import { canReturnUnaided } from '../lib/account'
import { Link } from '../lib/router'
import Icon from './Icon'

/**
 * The fields themselves, shared by the pop-up and the card so the two
 * cannot drift into asking for different things.
 */
function SetupForm({ player, onPlayerChange, onDone, onCancel, cancelLabel }) {
  // Prefilled from their name, which is the whole reason this is one
  // tap rather than a form: most people accept the suggestion.
  const [username, setUsername] = useState(() => suggestUsername(player.name))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // The server already requires both together for an account with
      // no password yet, so this needs no endpoint of its own.
      onPlayerChange(await setCredentials({ username, password }))
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="signin-form" onSubmit={handleSubmit}>
      <label htmlFor="setup-username">Username</label>
      <input
        id="setup-username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        required
      />
      <p className="hint">Letters, numbers and underscores.</p>

      <label htmlFor="setup-password">Password</label>
      <input
        id="setup-password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <p className="hint">At least 8 characters.</p>

      {error && <p className="error">{error}</p>}

      <div className="setup-actions">
        <button type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'Saving…' : 'Set it up'}
        </button>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  )
}

/**
 * The pop-up, shown once to a player who got in with a code.
 *
 * A native <dialog> rather than a hand-rolled overlay: showModal() gives
 * the focus trap, the backdrop and Escape-to-close for free, and all
 * three are easy to get subtly wrong by hand.
 */
export function SetupPrompt({ player, onPlayerChange }) {
  const ref = useRef(null)
  // Read once on mount. Reading it during render instead would reopen
  // the dialog on the re-render that dismissing it causes.
  const [eligible] = useState(() => !canReturnUnaided(player) && !isSetupDismissed())
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (eligible && ref.current && !ref.current.open) ref.current.showModal()
  }, [eligible])

  if (!eligible || done) return null

  // Fires for the button, the Escape key and a backdrop dismissal
  // alike, so there is one place that records "asked, and waved away".
  function close() {
    dismissSetup()
    ref.current?.close()
    setDone(true)
  }

  return (
    <dialog className="setup-dialog" ref={ref} onCancel={close} onClose={close}>
      <h2>You&rsquo;re in, {player.name.split(' ')[0]}.</h2>
      <p>
        Pick a username and password and you won&rsquo;t need your code again.
      </p>
      <SetupForm
        player={player}
        onPlayerChange={onPlayerChange}
        onDone={() => {
          ref.current?.close()
          setDone(true)
        }}
        onCancel={close}
        cancelLabel="Not now"
      />
    </dialog>
  )
}

/**
 * The standing offer, for anyone who waved the pop-up away or never saw
 * it. Expands in place rather than reopening the modal -- a card that
 * summons a dialog to show the same two fields is a step for nothing.
 */
export function SetupCard({ player, onPlayerChange }) {
  const [open, setOpen] = useState(false)

  if (canReturnUnaided(player)) return null

  return (
    <section className="setup-card" aria-label="Set up signing in">
      <h2>Signing in</h2>
      <p>
        Pick a username and password and you won&rsquo;t need your code again.
      </p>
      {open ? (
        <SetupForm
          player={player}
          onPlayerChange={onPlayerChange}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          cancelLabel="Cancel"
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Set it up
        </button>
      )}
    </section>
  )
}

/**
 * One line on the Overview until the player can come back without a
 * code. The form itself lives on You, so this only points there.
 */
export function SetupStrip({ player }) {
  if (canReturnUnaided(player)) return null
  return (
    <Link className="setup-strip" to="/you">
      <span className="setup-strip-what">
        <Icon name="key" size={16} />
        Skip the code next time.
      </span>
      <span className="setup-strip-go">Set up &rarr;</span>
    </Link>
  )
}
