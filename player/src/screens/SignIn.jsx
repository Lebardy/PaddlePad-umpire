// ============================================================
// The way in.
//
// Three panels, all visible at once rather than one behind a link.
// That is the point of this screen: the app used to open on a single
// "enter your code" box, which made it look — fairly — as though it had
// no registration at all.
//
// The three are not alternatives to pick between so much as different
// starting points:
//
//   Sign in   — you have been here before.
//   Create    — you have not, and nobody has scored you yet either.
//   Have a code — an umpire just handed you one. Fastest path by far.
//
// The code panel is opened DIRECTLY when the URL is /claim/CODE, so a
// QR still lands one tap from being signed in. Making a scanned QR
// arrive on a tab strip and wait to be told what it was for would be a
// clear regression, and that flow is what actually gets records claimed.
// ============================================================

import { useState } from 'react'
import Claim from './Claim'
import { loginPlayer, registerPlayer } from '../lib/api'
import { claimCodeFromUrl } from '../lib/router'

const TABS = [
  { id: 'signin', label: 'Sign in' },
  { id: 'create', label: 'Create account' },
  { id: 'code', label: 'Have a code' },
]

/**
 * Turns a display name into a username worth offering.
 *
 * Picking a handle is the one step an account adds over a code, so the
 * field arrives already filled rather than empty. Mirrors the server's
 * rule in validate.js -- if the two ever drift, the server is right and
 * the worst case is a suggestion the player has to edit.
 */
function suggestUsername(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20)
}

function SignInPanel({ onSignedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await loginPlayer({ username, password }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="signin-username">Username</label>
      <input
        id="signin-username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        required
      />

      <label htmlFor="signin-password">Password</label>
      <input
        id="signin-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="hint">
        Forgotten your password? Ask whoever scores your matches for a new
        code — it will sign you back in.
      </p>
    </form>
  )
}

function CreatePanel({ onSignedIn }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  // Once someone edits the username themselves, typing more of their
  // name must stop overwriting it.
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  // The server decides this, not the form -- only it knows whether the
  // name is already on the roster.
  const [needsCode, setNeedsCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function handleName(value) {
    setName(value)
    if (!usernameTouched) setUsername(suggestUsername(value))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await registerPlayer({ name, username, password, code }))
    } catch (err) {
      setError(err.message)
      // The refusal that is really a question. Revealing the field is
      // what turns "that name is taken" into "prove it's you and take
      // your matches with you".
      if (err.details?.needsCode) setNeedsCode(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="create-name">Your name</label>
      <input
        id="create-name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(event) => handleName(event.target.value)}
        required
      />
      <p className="hint">
        The name an umpire would write on the scoresheet, so your matches
        find you.
      </p>

      <label htmlFor="create-username">Username</label>
      <input
        id="create-username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(event) => {
          setUsernameTouched(true)
          setUsername(event.target.value)
        }}
        required
      />
      <p className="hint">Letters, numbers and underscores. Only you type this one.</p>

      <label htmlFor="create-password">Password</label>
      <input
        id="create-password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <p className="hint">At least 8 characters.</p>

      {needsCode && (
        <>
          <label htmlFor="create-code">Your code</label>
          <input
            id="create-code"
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
            Someone is already playing under that name, so we need to know
            it&rsquo;s you. Whoever scores your matches can show you a code —
            your matches so far will come with the account.
          </p>
        </>
      )}

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy || !name.trim() || !username.trim() || !password}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  )
}

function SignIn({ onSignedIn }) {
  // A scanned QR goes straight to the code panel with the field filled.
  const [tab, setTab] = useState(() => (claimCodeFromUrl() ? 'code' : 'signin'))

  return (
    <div className="gate">
      <h1>PaddlePad</h1>
      <p className="lede">See the matches your umpire has been recording for you.</p>

      <div className="gate-tabs" role="tablist" aria-label="How to get in">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="gate-tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'signin' && <SignInPanel onSignedIn={onSignedIn} />}
      {tab === 'create' && <CreatePanel onSignedIn={onSignedIn} />}
      {tab === 'code' && <Claim onClaimed={onSignedIn} />}
    </div>
  )
}

export default SignIn
