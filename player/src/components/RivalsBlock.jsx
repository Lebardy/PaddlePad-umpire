import { useEffect, useState } from 'react'
import { fetchRivals } from '../lib/api'
import { Link } from './Link'
import Icon from './Icon'

/**
 * Rivals and best partners, above everyone you've played. Worked out on
 * the server, which sends names only: never another player's rating.
 * Nothing at all until there is someone to show.
 */
function RivalsBlock({ bell = null }) {
  const [block, setBlock] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchRivals({ signal: controller.signal }).then(setBlock).catch(() => {})
    return () => controller.abort()
  }, [])
  if (!block || block.rivals.length + block.nearRating + block.partners.length === 0) return null

  return (
    <section className="rivals" aria-label="Rivals and best partners">
      <ul className="rivals-list">
        {block.rivals.map((rival) => (
          <li key={rival.name}>
            {rival.kind === 'matches' ? (
              <Link className="rivals-row" to={`/people/${encodeURIComponent(rival.name)}`}>
                <Icon name="target" size={18} label="Rival" />
                <span className="rivals-name">{rival.name}</span>
                <b className="rivals-figure">{rival.won}–{rival.lost}</b>
              </Link>
            ) : (
              <span className="rivals-row">
                <Icon name="equals" size={18} label="Near your rating" />
                <span className="rivals-name">{rival.name}</span>
              </span>
            )}
          </li>
        ))}
        {block.nearRating > 0 && (
          <li>
            <span className="rivals-row rivals-row--quiet">
              <Icon name="equals" size={18} />
              <span className="rivals-name">{block.nearRating} more near your rating</span>
            </span>
          </li>
        )}
        {block.partners.map((partner) => (
          <li key={partner.name}>
            <Link className="rivals-row" to={`/people/${encodeURIComponent(partner.name)}`}>
              <Icon name="swap" size={18} label="Best partner" />
              <span className="rivals-name">{partner.name}</span>
              <b className="rivals-figure">{partner.wins} wins</b>
            </Link>
          </li>
        ))}
      </ul>
      {bell}
    </section>
  )
}

export default RivalsBlock
