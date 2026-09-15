import { Link } from '../lib/router'

const PAGES = [
  { to: '/invites', label: 'Invite codes', current: (path) => path === '/' || path === '/invites' },
  { to: '/admins', label: 'Admins', ownerOnly: true, current: (path) => path === '/admins' },
  { to: '/activity', label: 'Activity', current: (path) => path === '/activity' },
]

/** The left menu and the page beside it. Only pages that exist are listed. */
export default function Layout({ admin, path, onSignOut, children }) {
  return (
    <div className="shell">
      <nav className="menu" aria-label="Admin pages">
        <p className="brand-mark">PaddlePad<span>Admin</span></p>
        <ul>
          {PAGES.filter((page) => !page.ownerOnly || admin.role === 'owner').map((page) => {
            const current = page.current(path)
            return (
              <li key={page.to}>
                <Link to={page.to} className={`menu-link${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined}>
                  {page.label}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="menu-foot">
          <Link to="/account" className={`menu-who${path === '/account' ? ' is-current' : ''}`}>
            <strong>{admin.name}</strong>
            <span>{admin.role === 'owner' ? 'Owner' : 'Admin'} · Account</span>
          </Link>
          <button type="button" className="menu-signout" onClick={onSignOut}>Sign out</button>
        </div>
      </nav>
      <main className="page">{children}</main>
    </div>
  )
}
