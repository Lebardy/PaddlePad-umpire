// ============================================================
// This month's match of the month, for someone who was not in it.
//
// The story of the GAME and nothing about the people in it beyond their
// names. Nobody's winning shots, mistakes or drops -- leaving a name
// visible agreed to being named on the board, not to having one's
// mistakes shown to everyone on PaddlePad.
//
// A player who WAS in it never lands here: the board sends them to
// their own full match page instead, shots and all.
//
// Laid out to be looked at more than read. It was a score and a
// squiggle, then a page of sentences; now it is one sentence of story,
// the numbers as icon chips, the whole game as a ribbon of points, and
// the reasons it was picked as badges -- with the exact wording a tap
// away behind "Why this game?". Every claim is still only made when it
// is true; it has just stopped being recited.
//
// The facts are counted on the server (server/src/drama.js), the same
// reading the board ranked the game on, so a game picked for its lead
// changes shows the number that got it picked.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchBoardMatch } from '../lib/api'
import { navigate } from '../lib/router'
import { headline, inWords } from '../lib/matchDrama'
import { useCountUp } from '../lib/motion'
import Icon from '../components/Icon'
import MatchChart from '../components/MatchChart'
import MomentumRibbon from '../components/MomentumRibbon'
import More from '../components/More'

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

function percent(share) {
  return `${Math.round(share * 100)}%`
}

// What separated it from the next-best game won by the same margin: a
// badge, and the full sentence behind "Why this game?". The server says
// which one actually decided it, so each is only ever shown when true.
const DECIDED = {
  losersGamePoints: {
    icon: 'flag',
    badge: 'Nearly went the other way',
    words: 'the one the losing side came closest to winning',
  },
  leadChanges: {
    icon: 'swap',
    badge: 'Most lead changes',
    words: 'the one where the lead changed hands most',
  },
  level: { icon: 'equals', badge: 'Level most often', words: 'the one that was level most often' },
  savedGamePoints: {
    icon: 'flag',
    badge: 'Most game points saved',
    words: 'the one with the most game points saved',
  },
  length: { icon: 'clock', badge: 'Went furthest', words: 'the one that went furthest' },
}

/**
 * Why it was eligible at all: played cleaner than these players usually
 * play. Only "these four usually manage" when every one of them had a
 * history to measure; otherwise the claim is weaker, because the month's
 * typical game stood in for someone.
 */
function cleanSentence(match) {
  if (!Number.isFinite(match.clean)) return null
  const who = match.isDoubles ? 'these four' : 'these two'
  const than =
    match.cleanBasis === 'players'
      ? `more than ${who} usually manage`
      : 'more than expected for these players'
  return `${percent(match.clean)} of rallies ended with a winning shot, ${than}.`
}

/** Why this game, counted among the games that could have been picked. */
function chosenSentence(match) {
  const pool = 'played better than their players usually do'
  if (match.outOf === 1) return `The only game this month ${pool}.`
  if (match.sameMargin === 1 || match.decidedBy === 'margin') {
    return `The closest of the ${match.outOf} games this month ${pool}.`
  }
  const margin = Math.abs(match.score.A - match.score.B)
  const base =
    `Won by ${inWords(margin)}: one of ${match.sameMargin} games this close ` +
    `among the ${match.outOf} ${pool} this month`
  const why = DECIDED[match.decidedBy]
  return why ? `${base}, and ${why.words}.` : `${base}.`
}

function Chip({ icon, children }) {
  return (
    <li className="ichip">
      <Icon name={icon} size={15} />
      <span>{children}</span>
    </li>
  )
}

const EMPTY_GAME = {
  path: [],
  moments: [],
  level: 0,
  leadChanges: 0,
  lowPoint: null,
  lastLevel: null,
  savedByLosers: 0,
  winnersGamePoints: 0,
  savedByWinners: 0,
  longestRun: { by: null, points: 0 },
}

function Story({ match }) {
  const winnersA = match.winner === 'A'
  const winners = (winnersA ? match.teamA : match.teamB).join(' & ')
  const losers = (winnersA ? match.teamB : match.teamA).join(' & ')
  const margins = match.margins ?? []
  const game = { ...EMPTY_GAME, ...match.game }
  // Scores are shown A–B everywhere on this page, the same way round as
  // the heading, even though the reading is done from the winners' side.
  const asShown = ({ winners: w, losers: l }) => (winnersA ? `${w}–${l}` : `${l}–${w}`)

  const scoreA = useCountUp(match.score.A)
  const scoreB = useCountUp(match.score.B)
  const clean = useCountUp(Number.isFinite(match.clean) ? Math.round(match.clean * 100) : NaN)

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

  const saved = game.savedByWinners + game.savedByLosers
  const margin = Math.abs(match.score.A - match.score.B)
  const decided = DECIDED[match.decidedBy]
  const when = new Date(match.endedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })

  return (
    <>
      <p className="board-match-eyebrow">
        <Icon name="trophy" size={15} /> Match of the month
      </p>
      <h1>
        {match.teamA.join(' & ')} <span className="board-match-v">v</span>{' '}
        {match.teamB.join(' & ')}
      </h1>

      <p className="board-match-score" aria-label={`${match.score.A} to ${match.score.B}`}>
        {scoreA}&ndash;{scoreB}
      </p>

      {margins.length > 0 && (
        <p className="board-match-headline rise">{headline(game, winners, match.pointTarget)}</p>
      )}

      <ul className="ichips rise" style={{ '--i': 1 }} aria-label="Match details">
        <Chip icon="calendar">{when}</Chip>
        <Chip icon="people">{match.isDoubles ? 'Doubles' : 'Singles'}</Chip>
        {match.minutes ? <Chip icon="clock">{match.minutes} min</Chip> : null}
        {match.rallies ? <Chip icon="matches">{match.rallies} rallies</Chip> : null}
      </ul>

      {margins.length > 0 && (
        <section className="detail-shape" aria-label="How the match went">
          <div className="board-match-head">
            <h2>How it went</h2>
            {/* Replaces "Above the line, X were ahead" -- the same fact,
                as a key rather than a sentence. */}
            <span className="board-match-legend">
              <i aria-hidden="true" /> {winners} ahead
            </span>
          </div>
          <MatchChart margins={margins} markers={markers} />

          {/* The game in numbers: each one only when it happened. */}
          <ul className="ichips" aria-label="The game in numbers">
            {Number.isFinite(match.clean) && <Chip icon="sparkle">{clean}% clean</Chip>}
            {game.level > 0 && <Chip icon="equals">Level {game.level}&times;</Chip>}
            {game.leadChanges > 0 && (
              <Chip icon="swap">
                {game.leadChanges} lead {game.leadChanges === 1 ? 'change' : 'changes'}
              </Chip>
            )}
            {saved > 0 && (
              <Chip icon="flag">
                {saved} game {saved === 1 ? 'point' : 'points'} saved
              </Chip>
            )}
            {game.longestRun.points >= 3 && (
              <Chip icon="flame">{game.longestRun.points} in a row</Chip>
            )}
          </ul>
        </section>
      )}

      {game.moments.length > 0 && (
        <section className="detail-shape" aria-label="Point by point">
          <h2>Point by point</h2>
          <MomentumRibbon
            moments={game.moments}
            path={game.path}
            asShown={asShown}
            winners={winners}
            losers={losers}
            lowIndex={game.lowPoint ? game.lowPoint.index : null}
          />
        </section>
      )}

      <section className="detail-shape" aria-label="Why this game">
        <h2>Why this game</h2>
        <ul className="badges">
          {Number.isFinite(match.clean) && (
            <li>
              <Icon name="sparkle" size={15} /> Cleaner than usual
            </li>
          )}
          <li>
            <Icon name="trophy" size={15} />{' '}
            {match.sameMargin === 1 || match.decidedBy === 'margin'
              ? 'Closest game'
              : `Won by ${margin}`}
          </li>
          {decided && match.sameMargin > 1 && (
            <li>
              <Icon name={decided.icon} size={15} /> {decided.badge}
            </li>
          )}
        </ul>
        <More label="Why this game?">
          {cleanSentence(match) && <p>{cleanSentence(match)}</p>}
          <p>{chosenSentence(match)}</p>
        </More>
      </section>

      <p className="board-footer">The game only — never anyone&rsquo;s shots.</p>
    </>
  )
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

  return (
    <div className="board-match">
      <BackLink />
      {match ? <Story match={match} /> : <p className="muted-inline">{error ?? 'Loading…'}</p>}
    </div>
  )
}

export default BoardMatch
