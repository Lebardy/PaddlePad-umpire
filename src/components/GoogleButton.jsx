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

function GoogleButton({ onCredential, disabled, caption }) {
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
    const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)')

    /**
     * Draws Google's button to suit the current theme.
     *
     * The theme matters more than it sounds. 'outline' is a white
     * button with a grey border, which on this app's dark background
     * (--bg: #15111f) reads as a foreign object pasted onto the page.
     * 'filled_black' is what Google provides for dark surfaces.
     *
     * Height is Google's to decide -- 'large' is 40px and there is no
     * option for more -- so the CSS pads the wrapper to bring the whole
     * thing up to the height of the app's own buttons instead.
     */
    const render = () => {
      if (cancelled || !holder.current) return
      // renderButton appends; without this a theme change would leave
      // two buttons stacked.
      holder.current.innerHTML = ''
      const width = Math.min(400, Math.round(holder.current.clientWidth) || 320)
      window.google.accounts.id.renderButton(holder.current, {
        theme: darkQuery?.matches ? 'filled_black' : 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'center',
        width,
      })
      setReady(true)
    }

    loadGoogleScript().then((ok) => {
      if (!ok || cancelled || !holder.current) return
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => handler.current(response.credential),
      })
      render()
      // Following the system the way the rest of the app does, rather
      // than staying whatever it was when the page loaded.
      darkQuery?.addEventListener('change', render)
    })

    return () => {
      cancelled = true
      darkQuery?.removeEventListener('change', render)
    }
  }, [])

  if (!CLIENT_ID) return null

  return (
    <div className="google-signin">
      {/* Google draws its own button in here. Kept mounted even before
          it is ready, because the node has to exist for renderButton. */}
      <div ref={holder} className={disabled ? 'is-disabled' : ''} />
      {!ready && <p className="login-note">Loading Google sign-in…</p>}
      {/* States the connection to the invite field above rather than
          leaving someone to infer it -- inferring it was the whole
          problem this screen had. */}
      {ready && caption && <p className="google-caption">{caption}</p>}
      <div className="or-divider">
        <span>or</span>
      </div>
    </div>
  )
}

export default GoogleButton
