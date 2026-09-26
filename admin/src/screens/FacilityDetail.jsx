import { useEffect, useState } from 'react'
import PageBoard from '../components/PageBoard'
import LogoEditor from '../components/LogoEditor'
import PanelTabs from '../components/PanelTabs'
import StatusTag from '../components/StatusTag'
import { fetchFacility, updateFacility } from '../lib/api'
import { navigate } from '../lib/navigation'
import { Link } from '../lib/router'

/** One facility's page: its details (with an edit form for any of its admins), then who works there, in tabs. */
export default function FacilityDetail({ id, me }) {
  // One result per id: whichever of facility / notFound / error came back.
  // Comparing its id to the current prop (rather than resetting state
  // inside the effect) is what tells a still-loading id apart from one
  // already answered.
  const [result, setResult] = useState(null)
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [peopleTab, setPeopleTab] = useState('umpires')

  useEffect(() => {
    let live = true
    fetchFacility(id)
      .then((data) => { if (live) setResult({ id, ...data }) })
      .catch((err) => {
        if (!live) return
        if (err.status === 404) setResult({ id, notFound: true })
        else setResult({ id, error: err.message })
      })
    return () => { live = false }
  }, [id])

  const loading = !result || result.id !== id
  const facility = loading ? null : result.facility

  function startEdit() {
    setFields({
      name: facility.name,
      area: facility.area ?? '',
      locationUrl: facility.locationUrl ?? '',
      openingHours: facility.openingHours ?? '',
      hourlyFee: facility.hourlyFeeCentavos != null ? String(facility.hourlyFeeCentavos / 100) : '',
      details: facility.details ?? '',
    })
    setSaveError(null)
    setEditing(true)
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      // Every field is sent, even a blank one -- a field the admin has
      // just cleared has to reach the server as an empty string, or a
      // PATCH (which only ever touches the keys it's sent) would leave
      // the old value in place instead of clearing it.
      const updated = await updateFacility(id, {
        name: fields.name.trim(),
        area: fields.area.trim(),
        locationUrl: fields.locationUrl.trim(),
        openingHours: fields.openingHours.trim(),
        hourlyFee: fields.hourlyFee.trim(),
        details: fields.details.trim(),
      })
      setResult((current) => ({ ...current, facility: updated }))
      setEditing(false)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="sheet"><p className="empty">Loading…</p></section>

  if (result.notFound) {
    return (
      <section className="sheet">
        <p className="empty missing">There’s no facility here.</p>
        <p><Link to="/facilities" className="back-link">← Facilities</Link></p>
      </section>
    )
  }

  if (result.error) {
    return (
      <section className="sheet">
        <p className="form-error" role="alert">{result.error}</p>
        <p><Link to="/facilities" className="back-link">← Facilities</Link></p>
      </section>
    )
  }

  const peopleTabs = [
    { id: 'umpires', label: 'Umpires', count: result.umpires.length },
    { id: 'admins', label: 'Admins', count: result.admins.length },
  ]
  const intro = [facility.area, facility.feeText, facility.openingHours].filter(Boolean).join(' · ')

  return (
    <section>
      <PageBoard
        title={facility.name}
        intro={
          <>
            {intro}
            {facility.locationUrl && (
              <>
                {intro && ' · '}
                <a href={facility.locationUrl} target="_blank" rel="noopener noreferrer">Open map</a>
              </>
            )}
          </>
        }
      />

      <div className="sheet">
        {me.role === 'owner' && <Link to="/facilities" className="back-link">← Facilities</Link>}

        <div>
          <h2 className="section-title">Details</h2>
          <LogoEditor
            facility={facility}
            onChange={(updated) => setResult((current) => ({ ...current, facility: updated }))}
          />
          {!editing && (facility.details ? <p>{facility.details}</p> : <p className="hint">No extra details yet.</p>)}
          {!editing && <button type="button" className="btn-quiet btn-small" onClick={startEdit}>Edit details</button>}

          {editing && (
            <form className="edit-panel" onSubmit={handleSave}>
              <div className="pair">
                <label className="field"><span>Name</span>
                  <input value={fields.name} maxLength={80} onChange={(e) => setFields({ ...fields, name: e.target.value })} required />
                </label>
                <label className="field"><span>Area</span>
                  <input value={fields.area} maxLength={120} onChange={(e) => setFields({ ...fields, area: e.target.value })} />
                </label>
              </div>
              <label className="field"><span>Map link</span>
                <input value={fields.locationUrl} maxLength={500} placeholder="https://maps.google.com/…"
                  onChange={(e) => setFields({ ...fields, locationUrl: e.target.value })} />
              </label>
              <div className="pair">
                <label className="field"><span>Opening hours</span>
                  <input value={fields.openingHours} maxLength={200} placeholder="e.g. 6 AM – 10 PM"
                    onChange={(e) => setFields({ ...fields, openingHours: e.target.value })} />
                </label>
                <label className="field"><span>Fee per hour, in pesos</span>
                  <input inputMode="decimal" value={fields.hourlyFee} placeholder="e.g. 150"
                    onChange={(e) => setFields({ ...fields, hourlyFee: e.target.value })} />
                </label>
              </div>
              <label className="field"><span>Details</span>
                <textarea maxLength={1000} value={fields.details} onChange={(e) => setFields({ ...fields, details: e.target.value })} />
              </label>
              {saveError && <p className="form-error" role="alert">{saveError}</p>}
              <div className="panel-actions">
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
                <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>

        <div>
          <PanelTabs label="Who works here" tabs={peopleTabs} current={peopleTab} onChange={setPeopleTab} />
          {peopleTab === 'umpires' && (result.umpires.length === 0 ? (
            <p className="empty">No umpires yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>
                  {result.umpires.map((umpire) => (
                    <tr key={umpire.id} className="row-clickable" onClick={() => navigate(`/umpires/${umpire.id}`)}>
                      <td><Link to={`/umpires/${umpire.id}`} className="row-link"><strong>{umpire.name}</strong></Link></td>
                      <td>{umpire.email}</td>
                      <td><StatusTag status={umpire.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {peopleTab === 'admins' && (result.admins.length === 0 ? (
            <p className="empty">No admins yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>
                  {result.admins.map((admin) => (
                    <tr key={admin.id}>
                      <td><strong>{admin.name}</strong></td>
                      <td>{admin.email}</td>
                      <td><span className={`tag ${admin.active ? 'tag-on' : 'tag-off'}`}>{admin.active ? 'On' : 'Off'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
