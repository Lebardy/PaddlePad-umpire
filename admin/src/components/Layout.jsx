import { Link } from '../lib/router'
import LampMark from './LampMark'

const PAGES = [
  { to: '/', label: 'Overview', current: (path) => path === '/' },
  { to: '/invites', label: 'Invite codes', current: (path) => path === '/invites' },
  { to: '/people', label: 'People', current: (path) => path === '/people' || path.startsWith('/people/') },
  { to: '/facilities', label: 'Facilities', facilityAdminLabel: 'Facility', current: (path) => path === '/facilities' || path.startsWith('/facilities/') },
  { to: '/admins', label: 'Admins', ownerOnly: true, current: (path) => path === '/admins' },
  { to: '/activity', label: 'Activity', current: (path) => path === '/activity' },
]

/** The board across the top of every page, and the page under it. Only pages that exist are listed. */
export default function Layout({ admin, facilityLabel, path, onSignOut, children }) {
  const onAccount = path === '/account'
  return (
    <div className="shell">
      <div className="topbar board-texture">
        <Link to="/" className="brand-mark"><LampMark />PaddlePad<span>Admin</span></Link>
        <nav aria-label="Admin pages">
          <ul className="tabs">
            {PAGES.filter((page) => !page.ownerOnly || admin.role === 'owner').map((page) => (
              <li key={page.to}>
                <Link to={page.to} aria-current={page.current(path) ? 'page' : undefined}>
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
            <span className="who-role">{admin.role === 'owner' ? 'Owner' : 'Admin'}{facilityLabel ? ` · ${facilityLabel}` : ''}</span>
          </Link>
          <button type="button" className="signout" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
      <main className="page">{children}</main>
    </div>
  )
}
