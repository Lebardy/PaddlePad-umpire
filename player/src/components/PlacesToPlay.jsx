// ============================================================
// Places to play: every facility on PaddlePad, below the people on the
// People tab, as tickets you swipe through sideways -- so a hundred
// places take one ticket's height and never push anything down.
// Nothing while loading, so the screen doesn't jump.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { fetchFacilities } from '../lib/api'
import { Link } from '../lib/router'
import FacilityLogo from './FacilityLogo'

function Ticket({ place }) {
  const facts = [
    place.openingHours && `Open ${place.openingHours}`,
    place.feeText && `Court ${place.feeText}`,
    place.umpireFeeText && `Umpire ${place.umpireFeeText}`,
  ].filter(Boolean)
  return (
    <li className="ticket-slot">
      <Link className="ticket" to={`/places/${place.id}`}>
        <span className={`ticket-plate${place.logoUrl ? '' : ' ticket-plate-bare'}`}>
          <FacilityLogo name={place.name} logoUrl={place.logoUrl} size="lg" />
        </span>
        <span className="ticket-stub">
          <span className="ticket-name">{place.name}</span>
          {place.area && <span className="ticket-area">{place.area}</span>}
          {facts.length > 0 && (
            <span className="ticket-facts">
              {facts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </span>
          )}
          <span className="ticket-go">See the place &rarr;</span>
        </span>
      </Link>
    </li>
  )
}

function PlacesToPlay() {
  const [places, setPlaces] = useState(null)
  const [error, setError] = useState(false)
  const [current, setCurrent] = useState(0)
  const railRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchFacilities({ signal: controller.signal })
      .then(setPlaces)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [])

  function onScroll() {
    const rail = railRef.current
    const first = rail?.firstElementChild
    if (!first) return
    const step = first.getBoundingClientRect().width + parseFloat(getComputedStyle(rail).columnGap || '0')
    setCurrent(Math.round(rail.scrollLeft / step))
  }

  if (error) {
    return (
      <section className="places" aria-label="Places to play">
        <p className="muted-inline">Couldn&rsquo;t load places to play.</p>
      </section>
    )
  }
  if (!places || places.length === 0) return null

  const single = places.length === 1
  return (
    <section className="places" aria-label="Places to play">
      <div className="section-head">
        <h2>Places to play</h2>
        <span className="chip">{places.length} {single ? 'place' : 'places'}</span>
      </div>
      <ul className={`ticket-rail${single ? ' ticket-rail-single' : ''}`} ref={railRef} onScroll={onScroll}>
        {places.map((place) => (
          <Ticket key={place.id} place={place} />
        ))}
      </ul>
      {!single && (
        <>
          {/* Markers only up to a dozen places; past that a count reads better than dots. */}
          {places.length <= 12 ? (
            <div className="ticket-dots" aria-hidden="true">
              {places.map((place, i) => (
                <i key={place.id} className={i === current ? 'on' : ''} />
              ))}
            </div>
          ) : (
            <p className="ticket-count" aria-hidden="true">{Math.min(current + 1, places.length)} of {places.length}</p>
          )}
          <p className="ticket-hint">Swipe for more places</p>
        </>
      )}
    </section>
  )
}

export default PlacesToPlay
