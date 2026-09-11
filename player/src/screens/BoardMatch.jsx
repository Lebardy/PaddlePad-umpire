// ============================================================
// This month's match of the month, for someone who was not in it.
//
// The story of the GAME and nothing about the people in it beyond their
// names: the score, how the lead moved, the longest run, where it
// turned. Nobody's winning shots, mistakes or drops. Leaving a name
// visible agreed to being named on the board -- not to having one's
// mistakes shown to everyone on PaddlePad.
//
// A player who WAS in it never lands here: the board sends them to
// their own full match page instead, shots and all.
//
// Told from the winning side, because a chart needs one point of view:
// above the line, the winners were ahead. The story helpers already
// speak neutrally ("Came back from 4 down"), so they are reused as they
// are, with the winners named in front.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchBoardMatch } from '../lib/api'
import { navigate } from '../lib/router'
import { longestRun, matchStory, turningPoint } from '../lib/story'
import Sparkline from '../components/Sparkline'

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

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1)
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

  if (error) {
    return (
      <div className="board-match">
        <BackLink />
        <p className="muted-inline">{error}</p>
      </div>
    )
  }
  if (!match) {
    return (
      <div className="board-match">
        <BackLink />
        <p className="muted-inline">Loading…</p>
      </div>
    )
  }

  const winners = (match.winner === 'A' ? match.teamA : match.teamB).join(' & ')
  const losers = (match.winner === 'A' ? match.teamB : match.teamA).join(' & ')
  const winnerScore = match.winner === 'A' ? match.score.A : match.score.B
  const loserScore = match.winner === 'A' ? match.score.B : match.score.A

  const margins = match.margins ?? []
  const story = matchStory(margins, true, match.pointTarget)
  // The longest run by EITHER side -- on a neutral page a losing pair's
  // five in a row is as much a part of the game as the winners' are.
  const winnersRun = longestRun(margins)
  const losersRun = longestRun(margins.map((m) => -m))
  const run =
    winnersRun >= losersRun
      ? { points: winnersRun, by: winners }
      : { points: losersRun, by: losers }
  const turn = turningPoint(margins)

  const when = new Date(match.endedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })

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

      <ul className="fact-chips" aria-label="Match details">
        <li className="chip">{when}</li>
        <li className="chip">{match.isDoubles ? 'Doubles' : 'Singles'}</li>
        <li className="chip">Played to {match.pointTarget}</li>
      </ul>

      <section className="detail-shape" aria-label="How the match went">
        <h2>How it went</h2>
        <Sparkline margins={margins} won size="lg" />
        <p className="muted-inline board-match-key">
          Above the line, {winners} {match.isDoubles ? 'were' : 'was'} ahead.
        </p>
        {story && (
          <p className="detail-story">
            {winners} {lowerFirst(story)}.
          </p>
        )}
        <ul className="detail-notes">
          {run.points >= 3 && (
            <li>
              Longest run: {run.points} points in a row, by {run.by}
            </li>
          )}
          {turn && (
            <li>
              {winners} took the lead for good at {turn.yours}&ndash;{turn.theirs}
            </li>
          )}
          <li>
            Final score {winnerScore}&ndash;{loserScore} to {winners}
          </li>
        </ul>
      </section>

      <p className="board-footer">
        Only how the game went is shown here — not anyone&rsquo;s individual
        shots.
      </p>
    </div>
  )
}

export default BoardMatch
