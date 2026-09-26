// ============================================================
// Places to play: every facility on PaddlePad, on the People tab.
//
// The first few, then "Show all": on a busy PaddlePad the list would
// otherwise push the people below it off the screen. Nothing while
// loading, like the monthly board above it, so the screen doesn't jump.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchFacilities } from '../lib/api'
import { Link } from '../lib/router'
import FacilityLogo from './FacilityLogo'

const ROWS_SHOWN = 5

function PlacesToPlay() {
  const [places, setPlaces] = useState(null)
  const [error, setError] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchFacilities({ signal: controller.signal })
      .then(setPlaces)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [])

  if (error) {
    return (
      <section className="places" aria-label="Places to play">
        <p className="muted-inline">Couldn&rsquo;t load places to play.</p>
      </section>
    )
  }
  if (!places || places.length === 0) return null

  const shown = showAll ? places : places.slice(0, ROWS_SHOWN)
  return (
    <section className="places" aria-label="Places to play">
      <div className="section-head">
        <h2>Places to play</h2>
      </div>
      <ul className="place-list">
        {shown.map((place) => (
          <li key={place.id}>
            <Link className="place-row" to={`/places/${place.id}`}>
              <FacilityLogo name={place.name} logoUrl={place.logoUrl} size="sm" />
              <span className="place-main">
                <span className="place-name">{place.name}</span>
                {place.area && <span className="place-area">{place.area}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {places.length > ROWS_SHOWN && !showAll && (
        <button type="button" className="show-all" onClick={() => setShowAll(true)}>
          Show all {places.length}
        </button>
      )}
    </section>
  )
}

export default PlacesToPlay
