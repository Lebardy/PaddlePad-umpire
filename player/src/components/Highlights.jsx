import { bestWin, topPartner } from '../lib/derive'

/**
 * Two small facts that make a history feel like it belongs to someone.
 *
 * Both are plain lookups over the player's own matches -- the biggest
 * winning margin, and who they play with most -- so neither depends on
 * the rest of the club existing, and neither can shift because someone
 * else played.
 */
function Highlights({ matches }) {
  const best = bestWin(matches)
  const partner = topPartner(matches)

  if (!best && !partner) return null

  return (
    <section className="highlights" aria-label="Highlights">
      {best && (
        <div className="highlight">
          <span className="highlight-label">Best win</span>
          <span className="highlight-value">
            {best.yourScore}–{best.theirScore}
          </span>
          <span className="highlight-note">
            against {best.opponents.join(' & ')}
          </span>
        </div>
      )}

      {partner && (
        <div className="highlight">
          <span className="highlight-label">Most played with</span>
          <span className="highlight-value">{partner.name}</span>
          <span className="highlight-note">
            {partner.won} of {partner.played} won together
          </span>
        </div>
      )}
    </section>
  )
}

export default Highlights
