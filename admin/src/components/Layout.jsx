import { Link } from '../lib/router'
import Icon from './Icon'
import LampMark from './LampMark'

const PAGES = [
  { to: '/', label: 'Overview', icon: 'overview', current: (path) => path === '/' },
  { to: '/players', label: 'Players', icon: 'people', current: (path) => path === '/players' || path.startsWith('/players/') },
  { to: '/umpires', label: 'Umpires', icon: 'clipboard', current: (path) => path === '/umpires' || path.startsWith('/umpires/') },
  { to: '/facilities', label: 'Facilities', icon: 'pin', facilityAdminLabel: 'Facility', current: (path) => path === '/facilities' || path.startsWith('/facilities/') },
  { to: '/managers', label: 'Managers', icon: 'shield', ownerOnly: true, current: (path) => path === '/managers' },
  { to: '/activity', label: 'Activity', icon: 'clock', current: (path) => path === '/activity' },
]

/** The board across the top of every page, and the page under it. Only pages that exist are listed. */
export default function Layout({ admin, facilityLabel, path, onSignOut, children }) {
  const onAccount = path === '/account'
  const site = admin.role === 'owner' ? 'Admin' : 'Manager'
  // A manager's sign already says Manager, so under their name goes their facility alone.
  const role = admin.role === 'owner' ? `Owner${facilityLabel ? ` · ${facilityLabel}` : ''}` : (facilityLabel ?? 'Manager')
  return (
    <div className="shell">
      <div className="topbar board-texture">
        <Link to="/" className="brand-mark" aria-label={`PaddlePad ${site}`}><LampMark /><span className="brand-name">PaddlePad</span><span>{site}</span></Link>
        <nav aria-label="Pages">
          <ul className="tabs">
            {PAGES.filter((page) => !page.ownerOnly || admin.role === 'owner').map((page) => (
              <li key={page.to}>
                <Link to={page.to} aria-current={page.current(path) ? 'page' : undefined}>
                  <Icon name={page.icon} size={16} />
                  {admin.role !== 'owner' && page.facilityAdminLabel ? page.facilityAdminLabel : page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="topbar-who">
          <Link
            to="/account"
            className="who-cell"
            aria-current={onAccount ? 'page' : undefined}
            title={facilityLabel ? `${admin.name} · ${facilityLabel}` : admin.name}
          >
            <strong>{admin.name}</strong>
            <span className="who-role">{role}</span>
          </Link>
          <button type="button" className="signout" onClick={onSignOut} aria-label="Sign out" title="Sign out"><Icon name="logout" size={18} className="icon-solo" /></button>
        </div>
      </div>
      <main className="page">{children}</main>
    </div>
  )
}
