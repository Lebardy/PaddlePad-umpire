// ============================================================
// Sign in with Google: an ordinary button in the site's style, using
// Google's token client. The server checks the token and matches the
// Google account to an admin; it never creates one. Renders nothing
// when VITE_GOOGLE_CLIENT_ID is unset, so email and password still work.
// ============================================================

import { useEffect, useRef, useState } from 'react'

const CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? ''
const SRC = 'https://accounts.google.com/gsi/client'
// openid and email are what the server actually reads. `profile` is
// only for the display name it offers back as a suggestion, and the
// sign-in survives without it.
const SCOPE = 'openid email profile'

/** Loads Google's script once, however many times this mounts. */
function loadGoogleScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(true)

  const existing = document.querySelector(`script[src="${SRC}"]`)
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => resolve(false))
    })
  }

  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = SRC
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })
}

/** Google's G, unaltered, as their guidelines require. */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

function GoogleButton({ onToken, disabled, label = 'Continue with Google' }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const client = useRef(null)
  // Held in a ref so a re-render — which happens on every keystroke in
  // the fields around it — never rebuilds the token client.
  const handler = useRef(onToken)
  useEffect(() => {
    handler.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!CLIENT_ID) return
    let cancelled = false

    loadGoogleScript().then((ok) => {
      if (cancelled) return
      if (!ok || !window.google?.accounts?.oauth2) {
        setFailed(true)
        return
      }
      client.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (response) => {
          if (response.access_token) handler.current(response.access_token)
        },
      })
      setReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!CLIENT_ID) return null

  // Said plainly rather than left as a button that does nothing. A
  // blocked or unreachable Google is not the end of getting in — the
  // code and the password both still work.
  if (failed) {
    return (
      <p className="hint google-unavailable">
        Google sign-in couldn&rsquo;t load. Use your email and password instead.
      </p>
    )
  }

  return (
    <div className="google-signin">
      <button
        type="button"
        className="google-btn"
        disabled={disabled || !ready}
        onClick={() => client.current?.requestAccessToken()}
      >
        <GoogleMark />
        <span>{ready ? label : 'Loading…'}</span>
      </button>
    </div>
  )
}

export default GoogleButton
