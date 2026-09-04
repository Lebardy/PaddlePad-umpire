// ============================================================
// Everyone you've shared a court with.
//
// Worth being precise about why this does not cross the line the app
// draws around other people's data: every name here comes out of THIS
// player's own match rows, which the server already sends. It answers
// "who do I play, and how does it go" -- a fact about the viewer's own
// history. It is not a roster, not a leaderboard, and there is no way
// from here to see anyone else's statistics.
//
// One list, not two. Splitting partners from opponents drew anyone who
// had been both -- four of twenty-four people in real data -- twice, and
// turned fifteen matches into twenty-eight near-identical rows. Both
// roles now travel on one row, because "we won two together, and you
// beat me once" is a sentence about one person.
//
// The numbers are counts and W/L marks rather than percentages. Most
// relationships here are a single match, where a percentage can only
// ever read 0%, 50% or 100% -- three pills for three matches say the
// same thing honestly.
// ============================================================

import { useState } from 'react'
import { Link } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { peopleSummary, peopleTogether } from '../lib/derive'
import { lastPlayedLabel } from '../lib/format'
import Avatar from '../components/Avatar'

// Enough to see a run without a regular partner's row running off the
// side of a phone.
const FORM_SHOWN = 6
// 28 rows was the complaint. The rest are one tap away.
const ROWS_SHOWN = 8

/** "2 together · 1 faced", with a side that never happened left out. */
function roleLine(person) {
  const parts = []
  if (person.together.played > 0) parts.push(`${person.together.played} together`)
  if (person.faced.played > 0) parts.push(`${person.faced.played} faced`)
  return parts.join(' · ')
}

function PersonRow({ person }) {
  return (
    <li>
      <Link className="person-row" to={`/people/${encodeURIComponent(person.name)}`}>
        <Avatar name={person.name} size="sm" />

        <div className="person-main">
          <div className="person-line">
            <span className="person-name">{person.name}</span>
            <span className="person-when">{lastPlayedLabel(person.lastPlayed)}</span>
          </div>

          <span className="person-roles">{roleLine(person)}</span>

          {/* The same form guide the overview draws, at list size.
              Reversed so it reads oldest to newest, left to right, and
              carrying the letter as well as the colour -- a status
              colour must never be the only thing saying what happened. */}
          <ol className="person-form" aria-label="Recent results">
            {[...person.form.slice(0, FORM_SHOWN)].reverse().map((entry) => (
              <li
                key={entry.id}
                className={`pill pill-sm ${
                  entry.won === null
                    ? 'pill-none'
                    : entry.won
                      ? 'pill-won'
                      : 'pill-lost'
                }`}
              >
                {entry.won === null ? '–' : entry.won ? 'W' : 'L'}
              </li>
            ))}
          </ol>
        </div>
      </Link>
    </li>
  )
}

function People() {
  const { matches } = usePlayerData()
  const people = peopleTogether(matches)
  const summary = peopleSummary(matches)
  const [showAll, setShowAll] = useState(false)

  if (people.length === 0) {
    return (
      <div className="people-screen">
        <h1>People</h1>
        <p className="muted">Play a match and the people in it appear here.</p>
      </div>
    )
  }

  const shown = showAll ? people : people.slice(0, ROWS_SHOWN)

  return (
    <div className="people-screen">
      <h1>People</h1>

      <p className="people-summary">
        {summary.people} {summary.people === 1 ? 'person' : 'people'}
        {summary.partners > 0 && ` · ${summary.partners} partnered`}
      </p>

      {/* Both cards are counts, deliberately. The win rates that stood
          here before needed three matches with the same person to mean
          anything, and in a club where partners rotate every match
          nobody reached three -- so the cards were gated out of
          existence and the screen gained nothing. */}
      <section className="highlights" aria-label="Standouts">
        {summary.playedMost && (
          <Link
            className="highlight"
            to={`/people/${encodeURIComponent(summary.playedMost.name)}`}
          >
            <span className="highlight-label">Played most</span>
            <span className="highlight-value">{summary.playedMost.name}</span>
            <span className="highlight-note">
              {summary.playedMost.total}{' '}
              {summary.playedMost.total === 1 ? 'match' : 'matches'}
            </span>
          </Link>
        )}

        <div className="highlight">
          <span className="highlight-label">You&rsquo;ve beaten</span>
          <span className="highlight-value">
            {summary.beaten} {summary.beaten === 1 ? 'person' : 'people'}
          </span>
          <span className="highlight-note">of {summary.faced} faced</span>
        </div>
      </section>

      <ul className="person-list">
        {shown.map((person) => (
          <PersonRow key={person.name} person={person} />
        ))}
      </ul>

      {people.length > ROWS_SHOWN && !showAll && (
        <button type="button" className="show-all" onClick={() => setShowAll(true)}>
          Show all {people.length}
        </button>
      )}
    </div>
  )
}

export default People
