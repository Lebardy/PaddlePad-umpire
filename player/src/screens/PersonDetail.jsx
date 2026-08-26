// ============================================================
// Your record with (or against) one person, and the matches behind it.
//
// A filter over the history already in memory, so it renders instantly
// and costs no request. Someone can appear as both a partner and an
// opponent, so both records are shown when both exist rather than
// picking one and hiding the other.
// ============================================================

import { navigate } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import Avatar from '../components/Avatar'
import MatchList from '../components/MatchList'

function record(matches) {
  return {
    played: matches.length,
    won: matches.filter((m) => m.won === true).length,
    lost: matches.filter((m) => m.won === false).length,
  }
}

function PersonDetail({ name }) {
  const { matches, loading } = usePlayerData()

  const withThem = matches.filter((m) => m.partner === name)
  const againstThem = matches.filter((m) => (m.opponents ?? []).includes(name))
  const all = matches.filter(
    (m) => m.partner === name || (m.opponents ?? []).includes(name),
  )

  if (all.length === 0) {
    return (
      <div className="person-detail">
        <BackLink />
        <p className="muted">
          {loading ? 'Loading…' : `You haven’t played with or against ${name}.`}
        </p>
      </div>
    )
  }

  const together = record(withThem)
  const against = record(againstThem)

  return (
    <div className="person-detail">
      <BackLink />

      <header className="person-head">
        <Avatar name={name} size="lg" />
        <h1>{name}</h1>
        <ul className="person-records">
          {together.played > 0 && (
            <li>
              <span className="pr-label">Together</span>
              <span className="pr-value">
                {together.won}&ndash;{together.lost}
              </span>
              <span className="pr-note">{together.played} matches</span>
            </li>
          )}
          {against.played > 0 && (
            <li>
              <span className="pr-label">Against</span>
              <span className="pr-value">
                {against.won}&ndash;{against.lost}
              </span>
              <span className="pr-note">{against.played} matches</span>
            </li>
          )}
        </ul>
      </header>

      <MatchList matches={all} />
    </div>
  )
}

function BackLink() {
  return (
    <button
      type="button"
      className="back-link"
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/people'))}
    >
      &larr; Back
    </button>
  )
}

export default PersonDetail
