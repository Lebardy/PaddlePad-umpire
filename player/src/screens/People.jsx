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
// ever read 0%, 50% or 100% -- three squares for three matches say the
// same thing honestly.
//
// One short row per person. The "Played most" box that stood above the
// list repeated its first row (the list is already in that order), and
// the "You've beaten" count now rides in the title line.
// ============================================================

import { useState } from 'react'
import { Link } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { peopleSummary, peopleTogether } from '../lib/derive'
import { lastPlayedLabel } from '../lib/format'
import { findPeople, peopleFacts } from '../lib/peopleWords'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import PlacesToPlay from '../components/PlacesToPlay'

// The last five results fit beside the name on a 320px phone.
const FORM_SHOWN = 5
const ROWS_SHOWN = 10
// Past this many, "Show all" also brings a name search.
const SEARCH_FROM = 20

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
        <span className="person-main">
          <span className="person-name">{person.name}</span>
          <span className="person-roles">{roleLine(person)}</span>
        </span>
        <span className="person-side">
          <span className="person-when">{lastPlayedLabel(person.lastPlayed)}</span>
          {/* Oldest to newest, left to right, with the letter as well as
              the colour -- a status colour must never be the only thing
              saying what happened. */}
          <ol className="person-form" aria-label="Recent results, oldest first">
            {[...person.form.slice(0, FORM_SHOWN)].reverse().map((entry) => (
              <li
                key={entry.id}
                className={`pill pill-xs ${entry.won === null ? 'pill-none' : entry.won ? 'pill-won' : 'pill-lost'}`}
              >
                {entry.won === null ? '–' : entry.won ? 'W' : 'L'}
              </li>
            ))}
          </ol>
        </span>
      </Link>
    </li>
  )
}

function People() {
  const { matches } = usePlayerData()
  const people = peopleTogether(matches)
  const summary = peopleSummary(matches)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')

  if (people.length === 0) {
    return (
      <div className="people-screen">
        <h1>People</h1>
        <p className="muted">Play a match and the people in it appear here.</p>
      </div>
    )
  }

  const searchable = showAll && people.length > SEARCH_FROM
  const shown = showAll ? findPeople(people, query) : people.slice(0, ROWS_SHOWN)

  return (
    <div className="people-screen">
      <h1>People</h1>
      <ul className="people-facts">
        {peopleFacts(summary).map((fact) => (
          <li key={fact.label}>
            <Icon name={fact.icon} size={18} />
            <b>{fact.figure}</b>
            <span>{fact.label}</span>
          </li>
        ))}
      </ul>

      {searchable && (
        <input
          id="people-find"
          className="people-find"
          type="search"
          placeholder="Find a name"
          aria-label="Find a name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      {shown.length > 0 ? (
        <ul className="person-list">
          {shown.map((person) => (
            <PersonRow key={person.name} person={person} />
          ))}
        </ul>
      ) : (
        <p className="muted-inline people-none">No one called &ldquo;{query.trim()}&rdquo;.</p>
      )}

      {people.length > ROWS_SHOWN && !showAll && (
        <button type="button" className="show-all" onClick={() => setShowAll(true)}>
          Show all {people.length}
        </button>
      )}

      <PlacesToPlay />
    </div>
  )
}

export default People
