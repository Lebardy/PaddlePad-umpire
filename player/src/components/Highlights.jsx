import { biggestComeback, topPartner } from '../lib/derive'
import { Link } from '../lib/router'

/**
 * Two small facts that make a history feel like it belongs to someone.
 *
 * Both are plain lookups over the player's own matches, so neither
 * depends on the rest of the club existing, and neither can shift
 * because someone else played.
 *
 * The first card used to be "Best win", which called bestWin() -- the
 * exact function behind "Biggest win" in Your best, rendered directly
 * below this. The overview showed one score twice under two labels. A
 * comeback is the honest counterpart rather than a second telling of the
 * same match: biggest win is how well it can go, this is how badly it
 * can go and still be won.
 *
 * Both cards open the thing they name, which the old inert version did
 * not -- a card that shows a match and cannot be tapped is the thing
 * that made this app feel like a page rather than an app.
 */
function Highlights({ matches }) {
  const comeback = biggestComeback(matches)
  const partner = topPartner(matches)

  if (!comeback && !partner) return null

  return (
    <section className="highlights" aria-label="Highlights">
      {comeback && (
        <Link className="highlight" to={`/matches/${comeback.match.id}`}>
          <span className="highlight-label">Biggest comeback</span>
          <span className="highlight-value">{comeback.deficit} down</span>
          <span className="highlight-note">
            won {comeback.match.yourScore}&ndash;{comeback.match.theirScore}
          </span>
        </Link>
      )}

      {partner && (
        <Link
          className="highlight"
          to={`/people/${encodeURIComponent(partner.name)}`}
        >
          <span className="highlight-label">Most played with</span>
          <span className="highlight-value">{partner.name}</span>
          <span className="highlight-note">
            {partner.won} of {partner.played} won together
          </span>
        </Link>
      )}
    </section>
  )
}

export default Highlights
