// ============================================================
// How the rallies this player ended actually ended, in one match.
//
// Two short lists -- won with a shot, lost with a mistake -- in everyday
// words, largest first, each with a bar scaled to its own list. Under
// them, one sentence per list naming the ending they had most often, with
// its count and, once they are rated, what it did to their points; before
// then no points appear.
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

// The row with the most rallies; on a tie, the one that moved the points
// most. Ranked by how often because the sentence says "the most rallies".
function mostOften(rows) {
  if (rows.length === 0) return null
  return rows.reduce((best, row) =>
    row.rallies > best.rallies ||
    (row.rallies === best.rallies && Math.abs(row.points ?? 0) > Math.abs(best.points ?? 0))
      ? row
      : best)
}

function signed(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

function RallyEndings({ rally }) {
  const endings = rally?.endings ?? []
  if (endings.length === 0) return null

  const won = endings.filter((row) => row.outcome === 'winner')
  const lost = endings.filter((row) => row.outcome === 'error')
  const rated = endings.some((row) => row.points !== null)

  const earned = mostOften(won)
  const cost = mostOften(lost)

  return (
    <div className="endings">
      <EndingList title="Won with a shot" rows={won} className="is-won" />
      <EndingList title="Lost with a mistake" rows={lost} className="is-lost" />

      {(earned || cost) && (
        <p className="endings-note">
          {cost && (rated
            ? <><strong>{endingPhrase(cost.ending)}</strong> lost you the most rallies in this match ({cost.rallies}, {signed(cost.points)}).{' '}</>
            : <><strong>{endingPhrase(cost.ending)}</strong> was your most common mistake.{' '}</>)}
          {earned && (rated
            ? <><strong>{endingPhrase(earned.ending)}</strong> won you the most ({earned.rallies}, {signed(earned.points)}).</>
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
