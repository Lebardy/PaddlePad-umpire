// ============================================================
// A player's matches, newest first, as slim rows under month bars --
// and on the Matches tab, under the night they were played.
//
// Each row is one line of who and the score, and one small line of
// everything else. The graph, the number chips and the match number
// live on the match's own page, which every row opens; repeating them on
// every row is what made this list seven screens long.
//
// The newest month is open and older ones fold, so getting back to July
// is one tap rather than a long scroll.
// ============================================================

import { useId, useState } from 'react'
import { Link } from './Link'
import { groupMatches, matchLine } from '../lib/nights'
import Icon from './Icon'

const resultOf = (match) => (match.won === null ? 'none' : match.won ? 'won' : 'lost')
const letterOf = (match) => (match.won === null ? '–' : match.won ? 'W' : 'L')

function MatchRow({ match, dated }) {
  const result = resultOf(match)
  return (
    <li>
      <Link className="mrow" to={`/matches/${match.id}`}>
        {/* The letter carries the result; the colour only reinforces it. */}
        <span className={`mrow-res res-${result}`}>{letterOf(match)}</span>
        <span className="mrow-main">
          <span className="mrow-vs">{(match.opponents ?? []).join(' & ')}</span>
          <span className="mrow-sub">{matchLine(match, { dated })}</span>
        </span>
        <span className="mrow-score" aria-label={`${match.yourScore} to ${match.theirScore}`}>
          {match.yourScore}
          <span className="mrow-theirs">&ndash;{match.theirScore}</span>
        </span>
      </Link>
    </li>
  )
}

/** One night: its date, name and record, then its matches. */
export function NightBlock({ night }) {
  return (
    <div className="night">
      <div className="night-head">
        <span className="night-when">
          {night.label}
          <span className="night-what">
            {night.sessionName ? `${night.sessionName} · ` : ''}
            {night.record}
          </span>
        </span>
        {/* Oldest to newest, left to right, as a run of results reads. */}
        <ol className="night-squares" aria-label="Results that night, oldest first">
          {[...night.matches].reverse().map((match) => (
            <li key={match.id} className={`pill pill-xs pill-${resultOf(match)}`}>{letterOf(match)}</li>
          ))}
        </ol>
      </div>
      <ol className="mrows">
        {night.matches.map((match) => <MatchRow key={match.id} match={match} dated={false} />)}
      </ol>
    </div>
  )
}

function Month({ month, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const count = month.matches.length
  return (
    <>
      <button
        type="button"
        className="month-bar"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((was) => !was)}
      >
        <span>
          <span className="month-name">{month.label}</span>{' '}
          <span className="month-count">
            {count} {count === 1 ? 'match' : 'matches'} &middot; <span className="month-record">{month.record}</span>
          </span>
        </span>
        <Icon name="chevron" size={20} className="month-chevron" />
      </button>
      <div id={bodyId} className="fold" inert={!open}>
        <div>
        {month.nights ? (
          month.nights.map((night) => <NightBlock key={night.key} night={night} />)
        ) : (
          <ol className="mrows">
            {month.matches.map((match) => <MatchRow key={match.id} match={match} dated />)}
          </ol>
        )}
        </div>
      </div>
    </>
  )
}

function MatchList({ matches, nights = true }) {
  const months = groupMatches(matches, { nights })
  return (
    <section className="match-list history" aria-label="Match history">
      {months.map((month, i) => (
        <Month key={month.key} month={month} defaultOpen={i === 0} />
      ))}
    </section>
  )
}

export default MatchList
