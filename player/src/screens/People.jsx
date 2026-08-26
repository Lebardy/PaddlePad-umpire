// ============================================================
// Who you play with, and who you play against.
//
// Worth being precise about why this does not cross the line the app
// draws around other people's data: every name here comes out of THIS
// player's own match rows, which the server already sends. It answers
// "how do I do when I partner Gemma" -- a fact about the viewer's own
// history. It is not a roster, not a leaderboard, and there is no way
// from here to see anyone else's statistics.
// ============================================================

import { Link } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { opponentRecords, partnerRecords } from '../lib/derive'
import Avatar from '../components/Avatar'

function PersonRow({ person, verb }) {
  return (
    <li>
      <Link className="person-row" to={`/people/${encodeURIComponent(person.name)}`}>
        <Avatar name={person.name} size="sm" />
        <span className="person-name">{person.name}</span>
        <span className="person-record">
          {person.won}&ndash;{person.lost}
        </span>
        <span className="person-played">
          {person.played} {verb}
        </span>
      </Link>
    </li>
  )
}

function People() {
  const { matches } = usePlayerData()
  const partners = partnerRecords(matches)
  const opponents = opponentRecords(matches)

  return (
    <div className="people-screen">
      <h1>People</h1>

      {partners.length > 0 && (
        <section aria-label="Partners">
          <h2>You play with</h2>
          <ul className="person-list">
            {partners.map((person) => (
              <PersonRow key={person.name} person={person} verb="together" />
            ))}
          </ul>
        </section>
      )}

      {opponents.length > 0 && (
        <section aria-label="Opponents">
          <h2>You play against</h2>
          {/* A doubles match counts for both opponents, so these add up
              to more than the matches played. "faced" says that. */}
          <ul className="person-list">
            {opponents.map((person) => (
              <PersonRow key={person.name} person={person} verb="faced" />
            ))}
          </ul>
        </section>
      )}

      {partners.length === 0 && opponents.length === 0 && (
        <p className="muted">Play a match and the people in it appear here.</p>
      )}
    </div>
  )
}

export default People
