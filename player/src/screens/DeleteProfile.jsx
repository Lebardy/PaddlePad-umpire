// ============================================================
// Deleting your profile.
//
// The honest version of this, which is not the same as the simple
// version. A player's matches are not solely theirs: their name is in
// every partner's and opponent's history, so removing the record would
// punch holes in other people's. What CAN always be destroyed is the
// account -- the username, the password and the claim code -- and for
// someone who has never played, there is nothing pointing at the record
// and it goes entirely.
//
// So the screen says which of the two will happen BEFORE asking for
// anything, and the server's answer, not this component's guess,
// decides what it says afterwards.
// ============================================================

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import { deleteProfile } from '../lib/api'

function DeleteProfile({ player, onDeleted }) {
  const { summary } = usePlayerData()
  const played = summary?.matches ?? 0

  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [typedName, setTypedName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Someone holding an unlocked phone must not be able to do this off
  // an already-open screen. A password is the real proof; where there
  // is none to ask for, typing your own name is at least a deliberate
  // act rather than a stray tap.
  const needsPassword = Boolean(player.username)
  const confirmed = needsPassword
    ? password.length > 0
    : typedName.trim().toLowerCase() === player.name.trim().toLowerCase()

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setResult(await deleteProfile({ password }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <section className="you-danger" aria-label="Profile deleted">
        <h2>Done</h2>
        <p>
          {result.deleted
            ? 'Your profile has been deleted.'
            : `Your sign-in has been deleted. The ${result.matches} ` +
              `${result.matches === 1 ? 'match' : 'matches'} you played stay ` +
              'on PaddlePad’s record.'}
        </p>
        <button type="button" className="sign-out" onClick={onDeleted}>
          Close
        </button>
      </section>
    )
  }

  if (!open) {
    return (
      <div className="you-danger">
        <button type="button" className="link danger" onClick={() => setOpen(true)}>
          Delete your profile
        </button>
      </div>
    )
  }

  return (
    <section className="you-danger is-open" aria-label="Delete your profile">
      <h2>Delete your profile</h2>

      {played > 0 ? (
        <>
          <p>
            <strong>
              You&rsquo;ve played {played} {played === 1 ? 'match' : 'matches'}.
            </strong>{' '}
            Those stay on PaddlePad&rsquo;s record — they&rsquo;re your
            partners&rsquo; and opponents&rsquo; history too, not only yours.
          </p>
          <p>
            What gets deleted is your sign-in: your username, your password and
            your code. You won&rsquo;t be able to get back in unless whoever
            scores your matches gives you a new code.
          </p>
        </>
      ) : (
        <p>
          <strong>You haven&rsquo;t played any matches.</strong> Nothing points
          at your record, so it will be deleted completely.
        </p>
      )}

      <form className="signin-form" onSubmit={handleSubmit}>
        {needsPassword ? (
          <>
            <label htmlFor="delete-password">Your password</label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </>
        ) : (
          <>
            <label htmlFor="delete-name">
              Type <strong>{player.name}</strong> to confirm
            </label>
            <input
              id="delete-name"
              type="text"
              autoComplete="off"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              required
            />
          </>
        )}

        {error && <p className="error">{error}</p>}

        <button type="submit" className="danger" disabled={busy || !confirmed}>
          {busy ? 'Deleting…' : 'Delete my profile'}
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Keep my profile
        </button>
      </form>
    </section>
  )
}

export default DeleteProfile
