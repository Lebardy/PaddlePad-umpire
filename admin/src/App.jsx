import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import { SIGNED_OUT_EVENT, clearSession, fetchMe, getStoredAdmin, getToken, listFacilities, storeAdmin } from './lib/api'
import { facilityLabel } from './lib/format'
import { movedPath } from './lib/paths'
import { matchPath, navigate, useRoute } from './lib/navigation'
import { applyTheme, getThemeChoice, watchSystemTheme } from './lib/theme'
import SetupScreen from './screens/Setup'
import SignIn from './screens/SignIn'
import Account from './screens/Account'
import Activity from './screens/Activity'
import Admins from './screens/Admins'
import Facilities from './screens/Facilities'
import FacilityDetail from './screens/FacilityDetail'
import Invites from './screens/Invites'
import Overview from './screens/Overview'
import People from './screens/People'
import PlayerDetail from './screens/PlayerDetail'
import UmpireDetail from './screens/UmpireDetail'

export default function App() {
  const path = useRoute()
  const [admin, setAdmin] = useState(() => (getToken() ? getStoredAdmin() : null))
  // Only fetched for a facility admin -- the owner's header reads 'All
  // facilities' without ever needing to know what exists.
  const [facilities, setFacilities] = useState(null)

  useEffect(() => {
    if (!admin?.id || admin?.role === 'owner') return
    let live = true
    listFacilities().then((rows) => { if (live) setFacilities(rows) }).catch(() => {})
    return () => { live = false }
  }, [admin?.id, admin?.role])

  // The server says this session is over (expired, or switched off).
  useEffect(() => {
    const onSignedOut = () => setAdmin(null)
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [])

  useEffect(() => watchSystemTheme(() => applyTheme(getThemeChoice())), [])

  // An old address (People, Invite codes) goes on to where it lives now.
  const moved = movedPath(path)
  useEffect(() => {
    if (moved) navigate(moved, { replace: true })
  }, [moved])

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
    if (path === '/') screen = <Overview me={admin} facilityLabel={facilityLabel(admin, facilities ?? [])} />
    else if (path === '/admins' && admin.role === 'owner') screen = <Admins me={admin} />
    else if (path === '/activity') screen = <Activity me={admin} />
    else if (path === '/account') screen = <Account admin={admin} onAdminChange={updateAdmin} />
    else if (moved) screen = null
    else if (path === '/players') screen = <People key="players" kind="players" me={admin} />
    else if (path === '/umpires') screen = <People key="umpires" kind="umpires" me={admin} />
    // Before '/umpires/:id', which would read "invites" as an umpire's id.
    else if (path === '/umpires/invites') screen = <Invites me={admin} />
    else if (matchPath('/players/:id', path)) screen = <PlayerDetail id={matchPath('/players/:id', path).id} me={admin} />
    else if (matchPath('/umpires/:id', path)) screen = <UmpireDetail id={matchPath('/umpires/:id', path).id} me={admin} />
    else if (path === '/facilities') screen = <Facilities me={admin} />
    else if (matchPath('/facilities/:id', path)) screen = <FacilityDetail id={matchPath('/facilities/:id', path).id} me={admin} />
    else screen = <p className="empty missing">There’s no page here.</p>
    content = (
      <Layout admin={admin} facilityLabel={facilityLabel(admin, facilities ?? [])} path={path} onSignOut={signOut}>
        {screen}
      </Layout>
    )
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
