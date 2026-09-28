// ============================================================
// This month on PaddlePad: Played most, Met most and Step up behind
// tabs on the black strip, then the match of the month in its own band.
// Step up names the leader of each category, each measured against
// their own earlier matches only.
// ============================================================

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import { Link } from '../lib/router'
import { STEP_UP_WORDS, namesList, shortDate, stepUpFigure } from '../lib/leaderboard'
import Icon from './Icon'

const TABS = [
  ['played', 'Played most'],
  ['met', 'Met most'],
  ['step', 'Step up'],
]

function resetLabel(resetsOn) {
  // A plain date: read as local midnight, not UTC.
  return new Date(`${resetsOn}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function CountList({ list, unit }) {
  if (list.rows.length === 0) return <p className="month-empty">Not yet this month.</p>
  return (
    <>
      <ol className="month-rows">
        {list.rows.map((row) => (
          <li key={row.name} className={`month-row${row.place <= 3 ? ' rank-top' : ''}`}>
            <span className="rank-place">{row.place}</span>
            <span className="rank-who">{row.name}</span>
            <span className="rank-ppr">
              {row.count}
              <small>{unit(row.count)}</small>
            </span>
          </li>
        ))}
      </ol>
      {list.moreTied > 0 && (
        <p className="month-more">
          and {list.moreTied} more with {list.moreCount} {unit(list.moreCount)} each
        </p>
      )}
    </>
  )
}

function StepUp({ leaders, monthStart }) {
  return (
    <>
      <ul className="stepup">
        {leaders.map((leader) => {
          const words = STEP_UP_WORDS[leader.key]
          const note = leader.key === 'ppr' ? `since ${shortDate(`${monthStart}T00:00:00`)}` : words.note
          return (
            <li key={leader.key} className="stepup-row">
              <Icon name={words.icon} size={20} className="stepup-icon" />
              <span className="stepup-label">{words.label}</span>
              {leader.names ? (
                <>
                  <span className="stepup-who">
                    {namesList(leader)}
                    <small>{note}</small>
                  </span>
                  <span className="stepup-fig">{stepUpFigure(leader.key, leader.figures)}</span>
                </>
              ) : (
                <span className="stepup-who stepup-empty">Not yet this month</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="rank-foot">Compared with their own earlier matches, never with anyone else&rsquo;s.</p>
    </>
  )
}

function MonthLists({ month }) {
  const { matches: mine } = usePlayerData()
  const [tab, setTab] = useState('played')
  const best = month.matchOfTheMonth

  return (
    <>
      <section className="month-band" aria-label="This month on PaddlePad">
        <div className="section-head">
          <h2>This month</h2>
          <span className="chip chip-quiet">Resets {resetLabel(month.resetsOn)}</span>
        </div>
        <div className="month-tabs" role="tablist" aria-label="Which list">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`month-tab${tab === key ? ' month-tab-on' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === 'played' && <CountList list={month.playedMost} unit={(n) => (n === 1 ? 'match' : 'matches')} />}
          {tab === 'met' && <CountList list={month.metMost} unit={(n) => (n === 1 ? 'person' : 'people')} />}
          {tab === 'step' && <StepUp leaders={month.stepUp} monthStart={month.monthStart} />}
        </div>
      </section>

      <section className="month-band" aria-label="Match of the month">
        <div className="section-head">
          <h2>Match of the month</h2>
        </div>
        {best ? (
          <Link
            className="motm"
            to={mine.some((m) => m.id === best.id) ? `/matches/${best.id}` : `/board/match/${best.id}`}
          >
            <span className="motm-teams">
              {best.teamA.join(' & ')} v {best.teamB.join(' & ')}
            </span>
            <span className="motm-score">
              {best.score.A}–{best.score.B}
            </span>
            <span className="motm-go">See how it went &rarr;</span>
          </Link>
        ) : (
          <p className="month-empty">Not yet this month.</p>
        )}
      </section>
    </>
  )
}

export default MonthLists
