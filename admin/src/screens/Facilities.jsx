import { useEffect, useState } from 'react'
import FacilityLogo from '../components/FacilityLogo'
import PageBoard, { TallyCell } from '../components/PageBoard'
import { createFacility, listFacilities } from '../lib/api'
import { navigate } from '../lib/navigation'
import { Link } from '../lib/router'

/** Facilities: where umpires work and matches are scored. The owner sees and manages every one; a facility admin is sent straight to their own. */
export default function Facilities({ me }) {
  const [facilities, setFacilities] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [openingHours, setOpeningHours] = useState('')
  const [hourlyFee, setHourlyFee] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    let live = true
    listFacilities()
      .then((rows) => { if (live) setFacilities(rows) })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [])

  // A facility admin only ever sees their own facility in this list --
  // go straight there rather than showing a one-row table.
  useEffect(() => {
    if (me.role !== 'owner' && facilities && facilities.length > 0) navigate(`/facilities/${facilities[0].id}`, { replace: true })
  }, [me.role, facilities])

  async function handleCreate(event) {
    event.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      const facility = await createFacility({
        name: name.trim(),
        area: area.trim() || undefined,
        locationUrl: locationUrl.trim() || undefined,
        openingHours: openingHours.trim() || undefined,
        hourlyFee: hourlyFee.trim() || undefined,
        details: details.trim() || undefined,
      })
      navigate(`/facilities/${facility.id}`)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (me.role !== 'owner') {
    if (error) return <section className="sheet"><p className="form-error" role="alert">{error}</p></section>
    if (facilities && facilities.length === 0) {
      return <section className="sheet"><p className="empty missing">You’re not linked to a facility yet. Ask the owner.</p></section>
    }
    return <section className="sheet"><p className="empty">Loading…</p></section>
  }

  return (
    <section>
      <PageBoard
        title="Facilities"
        intro="Where umpires work and matches are scored, each for an hourly fee it sets. Open one to see its admins, umpires and details."
      >
        <div className="tally">
          <TallyCell figure={facilities ? facilities.length : '–'} label="Facilities" />
        </div>
      </PageBoard>

      <div className="sheet">
        <form className="form-strip" onSubmit={handleCreate}>
          <h2 className="form-strip-title">New facility</h2>
          <label className="field grow">
            <span>Name</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field grow">
            <span>Area (optional)</span>
            <input value={area} maxLength={120} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Cebu IT Park" />
          </label>
          <label className="field grow">
            <span>Map link (optional)</span>
            <input value={locationUrl} maxLength={500} placeholder="https://maps.google.com/…" onChange={(e) => setLocationUrl(e.target.value)} />
          </label>
          <label className="field">
            <span>Opening hours (optional)</span>
            <input value={openingHours} maxLength={200} placeholder="e.g. 6 AM – 10 PM" onChange={(e) => setOpeningHours(e.target.value)} />
          </label>
          <label className="field">
            <span>Fee per hour, in pesos (optional)</span>
            <input inputMode="decimal" value={hourlyFee} onChange={(e) => setHourlyFee(e.target.value)} placeholder="e.g. 150" />
          </label>
          <label className="field grow">
            <span>Details (optional)</span>
            <textarea maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Making…' : 'Make facility'}</button>
        </form>

        {formError && <p className="form-error" role="alert">{formError}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {facilities === null && !error && <p className="empty">Loading…</p>}
        {facilities?.length === 0 && <p className="empty">No facilities yet. Make the first one above.</p>}

        {facilities && facilities.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Area</th>
                  <th>Fee</th>
                  <th className="col-when">Umpires</th>
                  <th className="col-when">Admins</th>
                </tr>
              </thead>
              <tbody>
                {facilities.map((facility) => (
                  <tr key={facility.id} className="row-clickable" onClick={() => navigate(`/facilities/${facility.id}`)}>
                    <td>
                      <span className="fac-name-cell">
                        <FacilityLogo name={facility.name} logoUrl={facility.logoUrl} size="sm" />
                        <Link to={`/facilities/${facility.id}`} className="row-link"><strong>{facility.name}</strong></Link>
                      </span>
                    </td>
                    <td>{facility.area ?? '—'}</td>
                    <td>{facility.feeText}</td>
                    {/* Counted by the list route itself: one request for the whole table. */}
                    <td className="col-when">{facility.umpireCount ?? '–'}</td>
                    <td className="col-when">{facility.adminCount ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
