// ============================================================
// How the rallies this player ended actually ended, in one match.
//
// Two short lists -- won with a shot, lost with a mistake -- in everyday
// words, largest first, each with a bar scaled to its own list. Under
// them, one sentence per list naming the ending they had most often (or
// the two tied for it; three or more are left to the list), with its
// count and, once they are rated, what it did to their points; before
// then no points appear.
//
// Only rallies this player ended themselves: a partner's shots describe
// the partner. Renders nothing when no rally they ended carried an ending,
// so the match screen can fall back to the older away/at-the-net bar.
// ============================================================

import { endingPhrase, namedLeaders } from '../lib/endingWords'

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

// The rows with the most rallies, larger points first. Ranked by how
// often because the sentence says "the most rallies"; ties all come back
// so none is singled out, and namedLeaders decides how many to name.
function leaders(rows) {
  const most = Math.max(0, ...rows.map((row) => row.rallies))
  return rows
    .filter((row) => row.rallies === most)
    .sort((a, b) => Math.abs(b.points ?? 0) - Math.abs(a.points ?? 0) || a.ending.localeCompare(b.ending))
}

// "Hitting out and hitting into the net", in bold, starting a sentence
// unless `lower`. Before a player is rated the sentence starts with "You"
// instead: "Hard put-away shots was your most common winning shot" fails
// on every plural phrase.
function Names({ rows, lower = false }) {
  return rows.map((row, i) => (
    <span key={row.ending}>
      {i > 0 && ' and '}
      <strong>{i === 0 && !lower ? endingPhrase(row.ending) : endingPhrase(row.ending).toLowerCase()}</strong>
    </span>
  ))
}

// "3, −6", or for two tied, "3 each, −5 together".
function numbers(rows) {
  if (rows.length === 1) return `${rows[0].rallies}, ${signed(rows[0].points)}`
  return `${rows[0].rallies} each, ${signed(rows.reduce((sum, row) => sum + row.points, 0))} together`
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

  const earned = namedLeaders(leaders(won))
  const cost = namedLeaders(leaders(lost))

  return (
    <div className="endings">
      <EndingList title="Won with a shot" rows={won} className="is-won" />
      <EndingList title="Lost with a mistake" rows={lost} className="is-lost" />

      {(earned || cost) && (
        <p className="endings-note">
          {cost && (rated
            ? <><Names rows={cost} /> lost you the most rallies in this match ({numbers(cost)}).{' '}</>
            : <>You lost the most rallies in this match with <Names rows={cost} lower />.{' '}</>)}
          {earned && (rated
            ? <><Names rows={earned} /> won you the most ({numbers(earned)}).</>
            : <>You won the most with <Names rows={earned} lower />.</>)}
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
