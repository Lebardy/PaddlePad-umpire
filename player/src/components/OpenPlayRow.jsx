// ============================================================
// One open play, the same row on a place page and in the list: the day
// (or the place), the hours, its chips, the manager's note, the spots
// taken, who's coming and the one button -- Join, Going (tap again to
// leave) or Full.
// ============================================================

import { useState } from 'react'
import { joinOpenPlay, leaveOpenPlay } from '../lib/api'
import { buttonState, courtsWords, dayTile, feeWords, timeSpan, whoWords } from '../lib/openPlay'
import { Link } from './Link'
import Avatar from './Avatar'
import Icon from './Icon'
import LevelEmblem from './LevelEmblem'

/** The privacy line, once per screen. */
export function OpenPlayNote() {
  return <p className="op-note"><Icon name="eye" size={16} />People you&rsquo;ve played with see your name.</p>
}

function OpenPlayRow({ row, tile, rank, onChange }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const state = buttonState(row)
  const who = whoWords(row)
  const day = dayTile(row.startsAt)

  async function toggle() {
    setSaving(true)
    setError(null)
    try {
      onChange(await (row.you ? leaveOpenPlay : joinOpenPlay)(row.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="op">
      <div className="op-main">
        {tile === 'place' ? (
          <Link className="op-tile" to={`/places/${row.facility.id}`} aria-label={row.facility.name}>
            <Avatar name={row.facility.name} size="md" />
          </Link>
        ) : (
          <span className="op-tile op-day"><b>{day.day}</b>{day.date}</span>
        )}
        <div className="op-what">
          {tile === 'place' && <p className="op-place">{row.facility.name}</p>}
          <p className="op-time">{timeSpan(row.startsAt, row.endsAt)}</p>
          <ul className="op-chips">
            <li className="chip"><Icon name="court" size={14} />{courtsWords(row.courts)}</li>
            {row.umpire && <li className="chip"><Icon name="clipboard" size={14} />Umpire</li>}
            <li className="chip"><Icon name="cash" size={14} />{feeWords(row.feeCentavos)}</li>
          </ul>
          {row.note && <p className="op-msg"><Icon name="info" size={16} />{row.note}</p>}
        </div>
        <p className="op-spots"><b>{row.count}<small>/{row.spots}</small></b><span>Spots</span></p>
      </div>
      <div className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${Math.min(100, Math.round((row.count / row.spots) * 100))}%` }} />
      </div>
      <div className="op-foot">
        <p className="op-who">
          {who.level && (
            <span className="op-level">
              {rank && <LevelEmblem rank={rank} size={20} className="op-emblem" />}
              {who.level}
            </span>
          )}
          {who.mix && <span className="op-level">{who.mix}</span>}
          {who.empty && <span className="op-names">{who.empty}</span>}
          {who.names && <span className="op-names">{who.names}</span>}
        </p>
        <button
          type="button"
          className={`op-go${state === 'join' ? '' : ' op-go-out'}${state === 'full' ? ' op-go-full' : ''}`}
          disabled={saving || state === 'full'}
          aria-busy={saving}
          aria-pressed={state === 'going' ? true : undefined}
          onClick={toggle}
        >
          {state === 'going' && <Icon name="check" size={18} />}
          {state === 'going' ? 'Going' : state === 'full' ? 'Full' : 'Join'}
        </button>
      </div>
      {error && <p className="op-error" role="alert">{error}</p>}
    </li>
  )
}

export default OpenPlayRow
