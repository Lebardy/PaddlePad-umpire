// ============================================================
// One place to play: its logo, where it is, when it's open, what it
// costs and how to get there -- each line only when an admin filled it
// in. Nothing about who runs it.
// ============================================================

import { useEffect, useState } from 'react'
import FacilityLogo from '../components/FacilityLogo'
import { fetchFacility } from '../lib/api'
import { navigate } from '../lib/router'

function BackLink() {
  return (
    <button
      type="button"
      className="back-link"
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/people'))}
    >
      &larr; Back
    </button>
  )
}

function FacilityPage({ id }) {
  // Kept with the id it belongs to, so opening another place never
  // shows the last one's details for a moment.
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchFacility(id, { signal: controller.signal })
      .then((facility) => setLoaded({ id, facility }))
      .catch((err) => {
        if (err?.name !== 'AbortError') setLoaded({ id, missing: true })
      })
    return () => controller.abort()
  }, [id])

  const current = loaded?.id === id ? loaded : null
  if (!current || current.missing) {
    return (
      <div className="place-page">
        <BackLink />
        <p className="muted">{current ? 'This place isn’t on PaddlePad any more.' : 'Loading…'}</p>
      </div>
    )
  }

  const place = current.facility
  const figure = (label, value, wide) => (
    <div className={`place-figure${wide ? ' place-figure-wide' : ''}${value ? '' : ' place-figure-none'}`}>
      <span className="place-figure-label">{label}</span>
      <b>{value ?? 'Not listed yet'}</b>
    </div>
  )
  return (
    <div className="place-page">
      <BackLink />
      <section className="place-board">
        <div className={`place-plate${place.logoUrl ? '' : ' place-plate-bare'}`}>
          <FacilityLogo name={place.name} logoUrl={place.logoUrl} size="lg" />
        </div>
        <div className="place-main">
          <span className="place-eyebrow">Place to play</span>
          <h1>{place.name}</h1>
          {place.area && <p className="place-where">{place.area}</p>}
        </div>
        <div className="place-figures">
          {figure('Open', place.openingHours, true)}
          {figure('Court fee', place.feeText)}
          {figure('Umpire fee', place.umpireFeeText)}
        </div>
      </section>

      {place.locationUrl && (
        <a className="place-map" href={place.locationUrl} target="_blank" rel="noopener noreferrer">
          Open in Maps &rarr;
        </a>
      )}
      {place.details && (
        <section className="place-about">
          <h2>About this place</h2>
          <p className="place-details">{place.details}</p>
        </section>
      )}
    </div>
  )
}

export default FacilityPage
