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
// Google sits ABOVE all three rather than inside one of them, and that
// placement is the whole argument: it is neither signing in nor
// creating an account until the server has looked, and burying it in
// one tab would make the other tab's users think it was not for them.
// The umpire app's login screen was rearranged for exactly this reason.
//
// The code panel is opened DIRECTLY when the URL is /claim/CODE, so a
// QR still lands one tap from being signed in. Making a scanned QR
// arrive on a tab strip and wait to be told what it was for would be a
// clear regression, and that flow is what actually gets records claimed.
// ============================================================

import { useState } from 'react'
import Claim from './Claim'
import GoogleButton from '../components/GoogleButton'

// Mirrors the check GoogleButton makes before rendering anything.
const GOOGLE_ENABLED = Boolean(import.meta.env?.VITE_GOOGLE_CLIENT_ID)
import { googleSignIn, loginPlayer, registerPlayer, takePausedNotice } from '../lib/api'
import { claimCodeFromUrl } from '../lib/router'
import { suggestUsername } from '../lib/username'

const TABS = [
  { id: 'signin', label: 'Sign in' },
  { id: 'create', label: 'Create account' },
  { id: 'code', label: 'Have a code' },
]

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

/**
 * Where a Google account nobody recognises has to say who it is.
 *
 * Google has proved an account exists and that this person owns it. It
 * has not said anything about which player on a club roster they are,
 * and it cannot: the only name it knows is the one on their Google
 * profile, which may be nothing like the name an umpire writes on a
 * scoresheet. So this asks, with Google's version already filled in as
 * a starting point.
 *
 * The code field appears only if the server says the name is taken.
 * That refusal is really a question — "prove it's you and take your
 * matches with you" — and is the same one CreatePanel handles.
 */
function GooglePending({ pending, onSignedIn, onCancel }) {
  const [name, setName] = useState(pending.suggestedName)
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // The same access token as the first attempt. Google's are good
      // for an hour, so there is no need to send anyone back through
      // the popup to answer a question about their own name.
      onSignedIn(await googleSignIn({ accessToken: pending.accessToken, name, code }))
    } catch (err) {
      setError(err.message)
      if (err.details?.needsCode) setNeedsCode(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="google-name">Your name</label>
      <input
        id="google-name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <p className="hint">
        The name an umpire would write on the scoresheet, so your matches
        find you. Change it if Google&rsquo;s version isn&rsquo;t what they
        call you.
      </p>

      {needsCode && (
        <>
          <label htmlFor="google-code">Your code</label>
          <input
            id="google-code"
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

      <button type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Finishing…' : 'Finish signing in'}
      </button>

      <button type="button" className="link gate-cancel" onClick={onCancel}>
        Use something else instead
      </button>
    </form>
  )
}

function SignIn({ onSignedIn }) {
  // A scanned QR goes straight to the code panel with the field filled.
  const [scanned] = useState(() => Boolean(claimCodeFromUrl()))
  const [tab, setTab] = useState(() => (scanned ? 'code' : 'signin'))
  // Read once, on mount, and removed from storage as it's read. Shown
  // here for the signin/create tabs; handed to Claim below so the code
  // tab -- the one a scanned QR lands on directly -- shows it too,
  // without reading (and clearing) it a second time.
  const [pausedNotice] = useState(() => takePausedNotice())
  // Set only when Google has answered and the server did not recognise
  // the account. Holding the token here rather than in GooglePending
  // keeps it alive across that form's re-renders.
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleGoogle(accessToken) {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await googleSignIn({ accessToken }))
    } catch (err) {
      // Not a failure: the server has never seen this Google account and
      // is asking who it belongs to.
      if (err.details?.needsName) {
        setPending({ accessToken, suggestedName: err.details.suggestedName ?? '' })
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (pending) {
    return (
      <div className="gate">
        <h1>Almost there</h1>
        <p className="lede">
          Google knows who you are. We still need to know which player that
          is.
        </p>
        <GooglePending
          pending={pending}
          onSignedIn={onSignedIn}
          onCancel={() => setPending(null)}
        />
      </div>
    )
  }

  return (
    <div className="gate">
      <h1>
        <img className="gate-logo" src="/favicon.svg" alt="" />
        PaddlePad
      </h1>
      <p className="lede">See the matches your umpire has been recording for you.</p>

      {pausedNotice && tab !== 'code' && <p className="error">{pausedNotice}</p>}

      {/* Withheld from someone who has just scanned a QR. They are one
          tap from being signed in with the code already in the field
          below, and offering a different way in above it would be the
          exact regression this screen was built to avoid. */}
      {!scanned && (
        <>
          <GoogleButton onToken={handleGoogle} disabled={busy} />
          {error && <p className="error">{error}</p>}
          {/* GoogleButton renders nothing without a client ID (a local
              checkout, say), and an "or" with nothing above it reads as
              something missing. */}
          {GOOGLE_ENABLED && <div className="or-divider">or</div>}
        </>
      )}

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
      {tab === 'code' && <Claim onClaimed={onSignedIn} pausedNotice={pausedNotice} />}
    </div>
  )
}

export default SignIn
