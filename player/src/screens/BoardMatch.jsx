// ============================================================
// This month's match of the month, for someone who was not in it.
//
// The story of the GAME and nothing about the people in it beyond their
// names: the score, a sentence saying what happened, when it was level
// and when the lead changed, how many chances to win it went begging,
// every point in order, and why this game was the one picked. Nobody's
// winning shots, mistakes or drops -- leaving a name visible agreed to
// being named on the board, not to having one's mistakes shown to
// everyone on PaddlePad.
//
// A player who WAS in it never lands here: the board sends them to
// their own full match page instead, shots and all.
//
// The first version was a score and a squiggle, and read as boring. What
// is here now was chosen by reading what every close game of the month
// would say, not just the one that happened to win -- see matchDrama.js.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchBoardMatch } from '../lib/api'
import { navigate } from '../lib/router'
import { headline, inWords } from '../lib/matchDrama'
import MatchChart from '../components/MatchChart'

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

function times(n) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${inWords(n)} times`
}

// What separated it from the next-best game won by the same margin, in
// the words the page uses. The server says which one actually decided
// it, so each of these is only ever said when it is true.
const DECIDED = {
  losersGamePoints: 'the one the losing side came closest to winning',
  leadChanges: 'the one where the lead changed hands most',
  level: 'the one that was level most often',
  savedGamePoints: 'the one with the most game points saved',
  length: 'the one that went furthest',
}

function percent(share) {
  return `${Math.round(share * 100)}%`
}

/**
 * Why it was eligible at all: it was played cleaner than these players
 * usually play. Only said as "these four usually manage" when every one
 * of them had a history to measure; otherwise the honest claim is
 * weaker, because the month's typical game stood in for someone.
 */
function cleanLine(match) {
  if (!Number.isFinite(match.clean)) return null
  const who = match.isDoubles ? 'these four' : 'these two'
  const than =
    match.cleanBasis === 'players'
      ? `more than ${who} usually manage`
      : 'more than expected for these players'
  return `A clean game: ${percent(match.clean)} of rallies ended with a winning shot, ${than}.`
}

/**
 * Why this game, in a claim that is actually true of it. Every count here
 * is of the games that could have been picked -- the ones played better
 * than their players usually do -- not every game this month.
 */
function whyChosen(match) {
  const pool = 'played better than their players usually do'
  if (match.outOf === 1) return `The only game this month ${pool}.`
  if (match.sameMargin === 1 || match.decidedBy === 'margin') {
    return `The closest of the ${match.outOf} games this month ${pool}.`
  }
  const margin = Math.abs(match.score.A - match.score.B)
  const base =
    `Won by ${inWords(margin)} — one of ${match.sameMargin} games this close ` +
    `among the ${match.outOf} ${pool} this month`
  const why = DECIDED[match.decidedBy]
  return why ? `${base}, and ${why}.` : `${base}.`
}

function BoardMatch({ id }) {
  const [match, setMatch] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchBoardMatch(id, { signal: controller.signal })
      .then(setMatch)
      .catch((err) => {
        if (err?.name === 'AbortError') return
        // A 404 is the ordinary case of a link from last month, not a
        // failure: the board has moved on.
        setError(
          err.status === 404
            ? 'This is no longer the match of the month — the board has moved on.'
            : err.message,
        )
      })
    return () => controller.abort()
  }, [id])

  if (error || !match) {
    return (
      <div className="board-match">
        <BackLink />
        <p className="muted-inline">{error ?? 'Loading…'}</p>
      </div>
    )
  }

  const winnersA = match.winner === 'A'
  const winners = (winnersA ? match.teamA : match.teamB).join(' & ')
  const losers = (winnersA ? match.teamB : match.teamA).join(' & ')
  const plural = match.isDoubles

  const margins = match.margins ?? []
  // Counted on the server, the same reading the board ranked it on, so a
  // game picked for its lead changes shows the number that got it picked.
  const game = match.game ?? {
    path: [], level: 0, leadChanges: 0, lowPoint: null, lastLevel: null,
    savedByLosers: 0, winnersGamePoints: 0, savedByWinners: 0,
    longestRun: { by: null, points: 0 },
  }
  // Scores are shown A–B everywhere on this page, the same way round as
  // the heading, even though the reading is done from the winners' side.
  const asShown = ({ winners: w, losers: l }) => (winnersA ? `${w}–${l}` : `${l}–${w}`)

  const markers = []
  if (game.lowPoint && game.lowPoint.losers - game.lowPoint.winners >= 2) {
    markers.push({ index: game.lowPoint.index, label: asShown(game.lowPoint), place: 'below' })
  }
  if (game.lastLevel) {
    markers.push({ index: game.lastLevel.index, label: asShown(game.lastLevel), place: 'below' })
  }
  if (game.path.length > 0) {
    markers.push({ index: game.path.length - 1, label: asShown(game.path.at(-1)), place: 'above' })
  }

  // The game in numbers. Each one only when it happened: "level no
  // times" is not drama.
  const facts = []
  if (Number.isFinite(match.clean)) {
    facts.push(`${percent(match.clean)} of rallies won by a winning shot`)
  }
  if (game.level > 0) facts.push(`Level ${times(game.level)}`)
  if (game.leadChanges > 0) facts.push(`Lead changed hands ${times(game.leadChanges)}`)
  if (game.savedByWinners > 0) {
    facts.push(`${winners} saved ${game.savedByWinners} game ${game.savedByWinners === 1 ? 'point' : 'points'}`)
  }
  if (game.savedByLosers > 0) {
    facts.push(`${losers} saved ${game.savedByLosers} game ${game.savedByLosers === 1 ? 'point' : 'points'}`)
  }
  if (game.longestRun.points >= 3) {
    facts.push(
      `${game.longestRun.points} points in a row by ${game.longestRun.by === 'winners' ? winners : losers}`,
    )
  }

  const when = new Date(match.endedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })
  const size = [
    match.minutes ? `${match.minutes} minutes` : null,
    match.rallies ? `${match.rallies} rallies` : null,
  ].filter(Boolean)

  return (
    <div className="board-match">
      <BackLink />
      <p className="board-match-eyebrow">Match of the month</p>
      <h1>
        {match.teamA.join(' & ')} <span className="board-match-v">v</span>{' '}
        {match.teamB.join(' & ')}
      </h1>

      <p className="board-match-score">
        {match.score.A}&ndash;{match.score.B}
      </p>

      {margins.length > 0 && (
        <p className="board-match-headline">
          {headline(game, winners, match.pointTarget)}
        </p>
      )}

      <ul className="fact-chips" aria-label="Match details">
        <li className="chip">{when}</li>
        <li className="chip">{match.isDoubles ? 'Doubles' : 'Singles'}</li>
        <li className="chip">Played to {match.pointTarget}</li>
      </ul>

      {margins.length > 0 && (
        <section className="detail-shape" aria-label="How the match went">
          <h2>How it went</h2>
          <MatchChart margins={margins} markers={markers} />
          <p className="muted-inline board-match-key">
            Above the line, {winners} {plural ? 'were' : 'was'} ahead.
          </p>

          {facts.length > 0 && (
            <ul className="board-match-facts" aria-label="The game in numbers">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {game.path.length > 0 && (
        <section className="detail-shape" aria-label="Point by point">
          <h2>Point by point</h2>
          <ol className="board-match-path">
            {game.path.map((point, i) => {
              const level = point.winners === point.losers
              const last = i === game.path.length - 1
              return (
                <li
                  key={i}
                  className={`${level ? 'is-level' : ''}${last ? ' is-final' : ''}`.trim() || undefined}
                >
                  {asShown(point)}
                </li>
              )
            })}
          </ol>
          <p className="muted-inline board-match-key">
            {match.teamA.join(' & ')}&rsquo;s score first. Outlined scores were level.
          </p>
        </section>
      )}

      <p className="board-match-why">
        {size.length > 0 && <span>{size.join(' · ')}. </span>}
        {cleanLine(match) && <span>{cleanLine(match)} </span>}
        {whyChosen(match)}
      </p>

      <p className="board-footer">
        Only how the game went is shown here — not anyone&rsquo;s individual
        shots.
      </p>
    </div>
  )
}

export default BoardMatch
