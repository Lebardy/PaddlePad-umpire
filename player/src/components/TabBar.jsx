// ============================================================
// The bottom navigation.
//
// At the bottom rather than the top because this is a phone app held in
// one hand, and the top of a modern phone screen is the hardest place to
// reach. It is fixed so it survives a long match list.
//
// Only shown once a player has matches -- see App.jsx. The tabs leading
// to empty screens is a worse first impression than one honest one --
// the Leaderboard only joins them once it is open.
// ============================================================

import Icon from './Icon'
import { Link } from './Link'

const TABS = [
  { to: '/', label: 'Overview', icon: 'overview' },
  { to: '/matches', label: 'Matches', icon: 'matches' },
  { to: '/people', label: 'People', icon: 'people' },
  { to: '/leaderboard', label: 'Leaderboard', icon: 'trophy', onlyWhenOpen: true },
  { to: '/you', label: 'You', icon: 'you' },
]

function isActive(tab, path) {
  // '/' would otherwise prefix-match every route.
  // The rating page and its graph are drill-downs from the overview, not
  // sections of their own, so Overview stays lit while they are open --
  // the same way a match stays under Matches.
  if (tab.to === '/') return path === '/' || path === '/rating' || path === '/rating/graph'
  // The match of the month now opens from the Leaderboard.
  if (tab.to === '/leaderboard' && path.startsWith('/board/')) return true
  return path === tab.to || path.startsWith(`${tab.to}/`)
}

function TabBar({ path, showLeaderboard }) {
  const shown = TABS.filter((tab) => !tab.onlyWhenOpen || showLeaderboard)
  const at = shown.findIndex((tab) => isActive(tab, path))
  return (
    <nav className="tabbar" aria-label="Sections" style={{ '--at': Math.max(at, 0), '--n': shown.length, '--lit': at < 0 ? 0 : 1 }}>
      {shown.map((tab) => {
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
