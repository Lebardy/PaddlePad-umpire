// ============================================================
// "I already have an account, and my umpire has a record for me."
//
// The gap this closes: a claim code could only ever be used by someone
// with NO account. /auth/player/claim and the needsCode branch of
// register both run without a token. So a player who signed up first,
// and was later handed a code for the record an umpire had been
// building under a different spelling of their name, had nowhere to
// enter it -- and signing out to claim it made things worse, stranding
// their username on the row they left behind.
//
// Three steps, because a merge is not undoable and the middle one is
// the whole point: enter the code, read exactly what is about to
// happen, then confirm. The numbers on the confirm step come from a dry
// run on the server, not from anything this screen worked out.
// ============================================================

import { useState } from 'react'
import { linkCode, updateProfile } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'

function Result({ result, onPlayerChange }) {
  const { refresh } = usePlayerData()
  const [name, setName] = useState(result.player.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [renamed, setRenamed] = useState(false)

  async function handleRename(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onPlayerChange(await updateProfile({ name }))
      refresh()
      setRenamed(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="link-result" role="status">
      <p className="link-headline">
        Done — {result.matches} {result.matches === 1 ? 'match is' : 'matches are'} on
        your account.
      </p>

      {/* The rename is offered here rather than merely mentioned,
          because "you can change it any time" is the reason the merge
          is allowed to take the umpire's spelling in the first place.
          A button makes that true; a sentence only claims it. */}
      {renamed ? (
        <p className="hint">Saved. Your umpire sees the new name on the roster.</p>
      ) : (
        <form className="signin-form" onSubmit={handleRename}>
          <label htmlFor="link-name">Your name</label>
          <input
            id="link-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <p className="hint">
            Your umpire records you as {result.player.name}. Change it here if
            you&rsquo;d rather they saw something else — it&rsquo;s the name they
            look for on the roster.
          </p>
          {error && <p className="error">{error}</p>}
          <button
            type="submit"
            disabled={busy || !name.trim() || name === result.player.name}
          >
            {busy ? 'Saving…' : 'Change my name'}
          </button>
        </form>
      )}
    </div>
  )
}

function LinkCode({ onPlayerChange }) {
  const { refresh } = usePlayerData()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  function reset() {
    setCode('')
    setPreview(null)
    setResult(null)
    setError(null)
    setNote(null)
  }

  async function run(confirm) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const data = await linkCode(code, { confirm })
      if (data.alreadyYours) {
        setNote('That code is already for this account — nothing to do.')
        setPreview(null)
        return
      }
      if (data.preview) {
        setPreview(data)
        return
      }
      onPlayerChange(data.player)
      // Everything derived from the history just changed underneath.
      refresh()
      setResult(data)
    } catch (err) {
      setError(err.message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <section className="link-code" aria-label="Link a code">
        <h2>Been playing already?</h2>
        <p>
          If someone has been scoring your matches, they can give you a code
          and those matches will join this account.
        </p>
        <button type="button" onClick={() => setOpen(true)}>
          I have a code
        </button>
      </section>
    )
  }

  return (
    <section className="link-code is-open" aria-label="Link a code">
      <h2>Been playing already?</h2>

      {result ? (
        <Result result={result} onPlayerChange={onPlayerChange} />
      ) : preview ? (
        <div className="link-confirm">
          {/* Everything that is about to happen, before it happens.
              A merge rewrites match history and cannot be undone. */}
          <p className="link-headline">
            Take your record from {preview.name}?
          </p>
          <p>
            Whoever scores your matches has {preview.theirs}{' '}
            {preview.theirs === 1 ? 'match' : 'matches'} recorded for{' '}
            <strong>{preview.name}</strong>
            {preview.yours > 0 && <> , and this account has {preview.yours}</>}. All{' '}
            {preview.matches} will end up on one account.
          </p>
          <p className="hint">
            Your umpire&rsquo;s spelling is the one that sticks, so you&rsquo;ll
            show up as <strong>{preview.name}</strong> from now on. You can change
            that straight afterwards. This can&rsquo;t be undone.
          </p>
          {error && <p className="error">{error}</p>}
          <div className="setup-actions">
            <button type="button" disabled={busy} onClick={() => run(true)}>
              {busy ? 'Linking…' : 'Yes, link them'}
            </button>
            <button type="button" className="link" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form
          className="signin-form"
          onSubmit={(event) => {
            event.preventDefault()
            run(false)
          }}
        >
          <label htmlFor="link-code">Your code</label>
          <input
            id="link-code"
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
            Ask whoever scores your matches — they can show you a code or a QR.
            You&rsquo;ll see what it holds before anything changes.
          </p>

          {error && <p className="error">{error}</p>}
          {note && <p className="hint">{note}</p>}

          <div className="setup-actions">
            <button type="submit" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Check this code'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                reset()
                setOpen(false)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

export default LinkCode
