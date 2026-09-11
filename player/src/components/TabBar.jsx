// ============================================================
// The bottom navigation.
//
// At the bottom rather than the top because this is a phone app held in
// one hand, and the top of a modern phone screen is the hardest place to
// reach. It is fixed so it survives a long match list.
//
// Only shown once a player has matches -- see App.jsx. Four tabs leading
// to four empty screens is a worse first impression than one honest one.
// ============================================================

import Icon from './Icon'
import { Link } from '../lib/router'

const TABS = [
  { to: '/', label: 'Overview', icon: 'overview' },
  { to: '/matches', label: 'Matches', icon: 'matches' },
  { to: '/people', label: 'People', icon: 'people' },
  { to: '/you', label: 'You', icon: 'you' },
]

function isActive(tab, path) {
  // '/' would otherwise prefix-match every route.
  // The rating page is a drill-down from the overview, not a section of
  // its own, so Overview stays lit while it is open -- the same way a
  // match stays under Matches.
  if (tab.to === '/') return path === '/' || path === '/rating'
  // The match of the month opens from the board on People, so People
  // stays lit while it is open.
  if (tab.to === '/people' && path.startsWith('/board/')) return true
  return path === tab.to || path.startsWith(`${tab.to}/`)
}

function TabBar({ path }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((tab) => {
        const active = isActive(tab, path)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`tab ${active ? 'tab-active' : ''}`}
            // The styling alone would leave a screen reader with four
            // identical links and no sense of where it is.
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={tab.icon} className="tab-icon" />
            <span className="tab-label">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default TabBar
