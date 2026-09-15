import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import { SIGNED_OUT_EVENT, clearSession, fetchMe, getStoredAdmin, getToken, storeAdmin } from './lib/api'
import { matchPath, navigate, useRoute } from './lib/router'
import { applyTheme, getThemeChoice, watchSystemTheme } from './lib/theme'
import SetupScreen from './screens/Setup'
import SignIn from './screens/SignIn'

export default function App() {
  const path = useRoute()
  const [admin, setAdmin] = useState(() => (getToken() ? getStoredAdmin() : null))

  // The server says this session is over (expired, or switched off).
  useEffect(() => {
    const onSignedOut = () => setAdmin(null)
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [])

  useEffect(() => watchSystemTheme(() => applyTheme(getThemeChoice())), [])

  // Reads who this is on every load: a name or role may have changed.
  useEffect(() => {
    if (!getToken()) return
    fetchMe().then((fresh) => { storeAdmin(fresh); setAdmin(fresh) }).catch(() => {})
  }, [])

  function updateAdmin(next) {
    storeAdmin(next)
    setAdmin(next)
  }

  function signOut() {
    clearSession()
    setAdmin(null)
    navigate('/', { replace: true })
  }

  const setup = matchPath('/setup/:secret', path)
  let content
  if (setup) {
    content = <SetupScreen secret={setup.secret} onSignedIn={(next) => { setAdmin(next); navigate('/', { replace: true }) }} />
  } else if (!admin) {
    content = <SignIn onSignedIn={setAdmin} />
  } else {
    let screen
    if (path === '/' || path === '/invites') screen = <p className="empty">Invite codes arrive in Task 9.</p>
    else if (path === '/admins' && admin.role === 'owner') screen = <p className="empty">Admins arrive in Task 9.</p>
    else if (path === '/activity') screen = <p className="empty">Activity arrives in Task 9.</p>
    else if (path === '/account') screen = <p className="empty">Account arrives in Task 9 for {admin.name}.</p>
    else screen = <p className="empty">There's no page here.</p>
    content = <Layout admin={admin} path={path} onSignOut={signOut}>{screen}</Layout>
  }

  return (
    <>
      <div className="narrow-screen" role="note">
        <p className="brand-mark">PaddlePad<span>Admin</span></p>
        <p>The admin site is made for a laptop or tablet. Open it on a bigger screen.</p>
      </div>
      <div className="wide-screen">{content}</div>
    </>
  )
}
