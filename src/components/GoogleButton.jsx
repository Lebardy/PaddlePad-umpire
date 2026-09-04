// ============================================================
// The Sign in with Google button.
//
// Renders nothing at all when VITE_GOOGLE_CLIENT_ID is unset, so a
// checkout without the variable -- or a deploy where it was forgotten --
// still runs and still signs in by password. A button that cannot work
// is worse than no button.
//
// Google's script is loaded on mount rather than from index.html so
// that a browser which cannot reach Google delays nothing else: the
// password form is already usable while this is still loading, and if
// it never loads the form is all there is.
// ============================================================

import { useEffect, useRef, useState } from 'react'

const CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? ''
const SRC = 'https://accounts.google.com/gsi/client'

/** Loads Google's script once, however many times this mounts. */
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(true)

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

function GoogleButton({ onCredential, disabled }) {
  const holder = useRef(null)
  const [ready, setReady] = useState(false)
  // Held in a ref so re-rendering (which happens on every keystroke in
  // the invite field) never re-initialises Google's button underneath
  // the user. Written in an effect rather than during render, which is
  // what React actually guarantees is safe.
  const handler = useRef(onCredential)
  useEffect(() => {
    handler.current = onCredential
  }, [onCredential])

  useEffect(() => {
    if (!CLIENT_ID) return
    let cancelled = false

    loadGoogleScript().then((ok) => {
      if (!ok || cancelled || !holder.current) return
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => handler.current(response.credential),
      })
      window.google.accounts.id.renderButton(holder.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 280,
      })
      setReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!CLIENT_ID) return null

  return (
    <div className="google-signin">
      {/* Google draws its own button in here. Kept mounted even before
          it is ready, because the node has to exist for renderButton. */}
      <div ref={holder} className={disabled ? 'is-disabled' : ''} />
      {!ready && <p className="login-note">Loading Google sign-in…</p>}
      <div className="or-divider">
        <span>or</span>
      </div>
    </div>
  )
}

export default GoogleButton
