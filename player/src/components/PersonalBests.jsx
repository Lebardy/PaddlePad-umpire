// ============================================================
// Standout matches, each one a way into the match itself.
//
// These are facts about this player alone -- their own best margin,
// their own cleanest match. Nothing here compares them to anyone else,
// which is what makes it safe to show from the very first match rather
// than waiting for a population to exist.
// ============================================================

import { Link } from './Link'
import Icon from './Icon'

function PersonalBests({ bests }) {
  return (
    <section className="bests" aria-label="Personal bests">
      <h2><Icon name="star" size={17} className="head-icon" />Your best</h2>
      <ul className="bests-list">
        {bests.map((best) => (
          <li key={best.key}>
            <Link className="best-card" to={`/matches/${best.matchId}`}>
              <span className="best-label">{best.label}</span>
              <span className="best-value">{best.value}</span>
              <span className="best-detail">{best.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default PersonalBests
