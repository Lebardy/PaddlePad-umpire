// ============================================================
// The playstyle step's level: one word on a dark plate, and on a tap
// every level of tonight's run with its average and spread, the
// player's own dot among them. Nothing at all when there is no level.
// ============================================================

import { Fragment, useState } from 'react'
import Icon from './Icon'
import LevelEmblem from './LevelEmblem'
import { LADDER_RANK, at, levelScale, plateLabel } from '../lib/levels'

function LevelPlate({ level }) {
  const [open, setOpen] = useState(false)
  if (!level) return null
  const scale = levelScale(level)
  return (
    <div className="level">
      <button type="button" className="level-plate" aria-expanded={open} aria-label={plateLabel(level)} onClick={() => setOpen(!open)}>
        <LevelEmblem rank={level.rank} size={56} className="level-plate-emblem" />
        <span className={`level-plate-name${level.name.length > 10 ? ' is-long' : ''}`}>{level.name}</span>
        <Icon name="chevron" size={20} className={`level-plate-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <ul className="level-rows" aria-label="Every level tonight">
          {level.levels.map((row) => (
            <Fragment key={row.name}>
              {/* Between this row and the one above it. */}
              {row.gapAbove ? <li className="level-gap"><Icon name="apart" size={14} />{row.gapAbove} apart</li> : null}
              <li className={`level-row${row.mine ? ' is-mine' : ''}`}>
                <LevelEmblem rank={LADDER_RANK[row.name]} size={26} className="level-row-emblem" />
                <span className="level-row-name">
                  {row.name}
                  <span className="level-row-players"><Icon name="people" size={13} />{row.players}</span>
                </span>
                <span className="level-row-track" aria-hidden="true">
                  <span className="level-row-band" style={{ left: `${at(scale, row.average - row.spread)}%`, width: `${at(scale, row.average + row.spread) - at(scale, row.average - row.spread)}%` }} />
                  <span className="level-row-average" style={{ left: `${at(scale, row.average)}%` }} />
                  {row.mine && Number.isFinite(level.you) && <span className="level-row-you" style={{ left: `${at(scale, level.you)}%` }} />}
                </span>
                <span className="level-row-number">{row.average.toLocaleString()}</span>
              </li>
            </Fragment>
          ))}
          {Number.isFinite(level.you) && (
            <li className="level-key"><span className="level-key-dot" />You {level.you.toLocaleString()}<span className="level-key-avg">Avg</span></li>
          )}
        </ul>
      )}
    </div>
  )
}

export default LevelPlate
