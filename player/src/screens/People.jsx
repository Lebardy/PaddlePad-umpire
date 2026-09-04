// ============================================================
// Who you play with, and who you play against.
//
// Worth being precise about why this does not cross the line the app
// draws around other people's data: every name here comes out of THIS
// player's own match rows, which the server already sends. It answers
// "how do I do when I partner Gemma" -- a fact about the viewer's own
// history. It is not a roster, not a leaderboard, and there is no way
// from here to see anyone else's statistics.
//
// The two cards and the bars are here because the numbers alone were
// correct and unreadable: a column of "5-1" tells you nothing at a
// glance about who you actually do well with, which is the one question
// this tab exists to answer.
// ============================================================

import { Link } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { decidedRate, opponentRecords, partnerRecords, peopleHighlights } from '../lib/derive'
import Avatar from '../components/Avatar'

function percent(rate) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/**
 * A named person with the record behind the name.
 *
 * The bar borrows the track-and-fill shape and the --seq tokens from
 * Meter rather than using Meter itself: that component is a label row, a
 * track and a caption, which is taller than the list row it would have
 * to live in. Same visual language, no block component forced into a
 * list.
 */
function PersonRow({ person, verb }) {
  const rate = decidedRate(person)

  return (
    <li>
      <Link className="person-row" to={`/people/${encodeURIComponent(person.name)}`}>
        <Avatar name={person.name} size="sm" />

        <div className="person-main">
          <div className="person-line">
            <span className="person-name">{person.name}</span>
            <span className="person-record">
              {person.won}&ndash;{person.lost}
            </span>
            <span className="person-rate">{percent(rate)}</span>
          </div>

          {/* Only once something has been decided. A dash already said
              "no data"; an empty track would say "0%". */}
          {rate !== null && (
            <div
              className="person-bar"
              role="img"
              aria-label={`Won ${Math.round(rate * 100)} percent`}
            >
              <span className="person-bar-fill" style={{ width: `${rate * 100}%` }} />
            </div>
          )}

          <span className="person-played">
            {person.played} {verb}
          </span>
        </div>
      </Link>
    </li>
  )
}

/** Best partner or toughest opponent, as a card into that person. */
function PersonHighlight({ label, person }) {
  return (
    <Link className="highlight" to={`/people/${encodeURIComponent(person.name)}`}>
      <span className="highlight-label">{label}</span>
      <span className="highlight-value">{person.name}</span>
      <span className="highlight-note">
        {person.won}&ndash;{person.lost} &middot; {percent(decidedRate(person))}
      </span>
    </Link>
  )
}

function People() {
  const { matches } = usePlayerData()
  const partners = partnerRecords(matches)
  const opponents = opponentRecords(matches)
  const { bestPartner, toughestOpponent } = peopleHighlights(matches)

  // Opponents and partners overlap -- the same person can be both -- so
  // this counts distinct names rather than adding the two lists.
  const everyone = new Set([...partners, ...opponents].map((p) => p.name))

  return (
    <div className="people-screen">
      <h1>People</h1>

      {everyone.size > 0 && (
        <p className="people-summary">
          {everyone.size} {everyone.size === 1 ? 'person' : 'people'}
          {partners.length > 0 && (
            <>
              {' '}
              &middot; {partners.length}{' '}
              {partners.length === 1 ? 'partner' : 'partners'}
            </>
          )}
        </p>
      )}

      {(bestPartner || toughestOpponent) && (
        <section className="highlights" aria-label="Standouts">
          {bestPartner && (
            <PersonHighlight label="Best partner" person={bestPartner} />
          )}
          {toughestOpponent && (
            <PersonHighlight label="Toughest opponent" person={toughestOpponent} />
          )}
        </section>
      )}

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
