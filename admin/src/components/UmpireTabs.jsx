import { Link } from '../lib/router'

/** The two halves of the Umpires page: who they are, and the codes that let new ones join. */
export default function UmpireTabs({ current }) {
  return (
    <nav className="subtabs" aria-label="Umpires or invite codes">
      <Link to="/umpires" aria-current={current === 'umpires' ? 'page' : undefined}>Umpires</Link>
      <Link to="/umpires/invites" aria-current={current === 'invites' ? 'page' : undefined}>Invite codes</Link>
    </nav>
  )
}
