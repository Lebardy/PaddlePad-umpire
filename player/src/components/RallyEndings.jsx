// ============================================================
// How the rallies this player ended actually ended, in one match.
//
// Two short lists -- won with a shot, lost with a mistake -- in everyday
// words, largest first, each with a bar scaled to its own list. Under
// them, one short line per list naming the ending they had most often (or
// the two tied for it; three or more are left to the list), with its
// count and, once they are rated, what it did to their points; before
// then no numbers appear.
//
// Only rallies this player ended themselves: a partner's shots describe
// the partner. Renders nothing when no rally they ended carried an ending,
// so the match screen can fall back to the older away/at-the-net bar.
// ============================================================

import { endingPhrase, namedLeaders } from '../lib/endingWords'
import Icon from './Icon'

function EndingList({ title, icon, rows, className }) {
  if (rows.length === 0) return null
  const most = Math.max(...rows.map((row) => row.rallies))
  return (
    <div className={`endings-group ${className}`}>
      <h3 className="endings-head"><Icon name={icon} size={16} />{title}</h3>
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
// often because the line says "most"; ties all come back
// so none is singled out, and namedLeaders decides how many to name.
function leaders(rows) {
  const most = Math.max(0, ...rows.map((row) => row.rallies))
  return rows
    .filter((row) => row.rallies === most)
    .sort((a, b) => Math.abs(b.points ?? 0) - Math.abs(a.points ?? 0) || a.ending.localeCompare(b.ending))
}

// "Hitting out and hitting into the net", in bold, starting the line.
function Names({ rows }) {
  return rows.map((row, i) => (
    <span key={row.ending}>
      {i > 0 && ' and '}
      <strong>{i === 0 ? endingPhrase(row.ending) : endingPhrase(row.ending).toLowerCase()}</strong>
    </span>
  ))
}

// "3 rallies, −6 PPR", or for two tied, "3 each, −5 PPR together".
function numbers(rows) {
  const n = rows[0].rallies
  if (rows.length === 1) return `${n} ${n === 1 ? 'rally' : 'rallies'}, ${signed(rows[0].points)} PPR`
  return `${n} each, ${signed(rows.reduce((sum, row) => sum + row.points, 0))} PPR together`
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
      <EndingList title="Won with a shot" icon="check" rows={won} className="is-won" />
      <EndingList title="Lost with a mistake" icon="cross" rows={lost} className="is-lost" />

      {(earned || cost) && (
        <div className="endings-leads">
          {cost && (
            <p className="endings-lead is-lost">
              <Icon name="arrowDown" size={16} />
              <span><Names rows={cost} /> cost you most{rated && <>: <span className="endings-nums">{numbers(cost)}</span></>}</span>
            </p>
          )}
          {earned && (
            <p className="endings-lead is-won">
              <Icon name="arrowUp" size={16} />
              <span><Names rows={earned} /> won you most{rated && <>: <span className="endings-nums">{numbers(earned)}</span></>}</span>
            </p>
          )}
        </div>
      )}

      {rally.untagged > 0 && (
        <p className="endings-untagged">
          {rally.untagged === 1
            ? '1 rally had no ending recorded.'
            : `${rally.untagged} rallies had no ending recorded.`}
        </p>
      )}
    </div>
  )
}

export default RallyEndings
