// ============================================================
// How the rallies this player ended actually ended, in one match.
//
// Two short lists -- won with a shot, lost with a mistake -- in everyday
// words, largest first, each with a bar scaled to its own list. Under
// them, one sentence per list naming the ending that moved the player's
// points most; before they are rated (no points yet) it names the most
// frequent ending instead, so no points appear early.
//
// Only rallies this player ended themselves: a partner's shots describe
// the partner. Renders nothing when no rally they ended carried an ending,
// so the match screen can fall back to the older away/at-the-net bar.
// ============================================================

import { endingPhrase } from '../lib/endingWords'

function EndingList({ title, rows, className }) {
  if (rows.length === 0) return null
  const most = Math.max(...rows.map((row) => row.rallies))
  return (
    <div className={`endings-group ${className}`}>
      <h3 className="endings-head">{title}</h3>
      <ul className="endings-list">
        {rows.map((row) => (
          <li key={row.ending} className="endings-row">
            <span className="endings-name">{endingPhrase(row.ending)}</span>
            <span className="endings-track" aria-hidden="true">
              <span className="endings-fill" style={{ width: `${Math.round((row.rallies / most) * 100)}%` }} />
            </span>
            <span className="endings-count">{row.rallies}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function mostMoved(rows, sign) {
  const moved = rows.filter((row) => row.points !== null && Math.sign(row.points) === sign)
  if (moved.length === 0) return null
  return moved.reduce((best, row) => (Math.abs(row.points) > Math.abs(best.points) ? row : best))
}

function RallyEndings({ rally }) {
  const endings = rally?.endings ?? []
  if (endings.length === 0) return null

  const won = endings.filter((row) => row.outcome === 'winner')
  const lost = endings.filter((row) => row.outcome === 'error')
  const rated = endings.some((row) => row.points !== null)

  const earned = rated ? mostMoved(won, 1) : won[0]
  const cost = rated ? mostMoved(lost, -1) : lost[0]

  return (
    <div className="endings">
      <EndingList title="Won with a shot" rows={won} className="is-won" />
      <EndingList title="Lost with a mistake" rows={lost} className="is-lost" />

      {(earned || cost) && (
        <p className="endings-note">
          {cost && (rated
            ? <><strong>{endingPhrase(cost.ending)}</strong> cost you the most points in this match ({`−${Math.abs(cost.points)}`}).{' '}</>
            : <><strong>{endingPhrase(cost.ending)}</strong> was your most common mistake.{' '}</>)}
          {earned && (rated
            ? <><strong>{endingPhrase(earned.ending)}</strong> earned you the most (+{earned.points}).</>
            : <><strong>{endingPhrase(earned.ending)}</strong> was your most common winning shot.</>)}
        </p>
      )}

      {rally.untagged > 0 && (
        <p className="endings-untagged">
          {rally.untagged === 1
            ? '1 of your rallies had no ending recorded.'
            : `${rally.untagged} of your rallies had no ending recorded.`}
        </p>
      )}
    </div>
  )
}

export default RallyEndings
