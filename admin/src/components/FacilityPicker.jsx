import { useEffect, useState } from 'react'
import { listFacilities } from '../lib/api'

/**
 * A select of facilities, for the owner only -- a facility admin is
 * always pinned to their own, so this renders nothing for them and
 * every screen that uses it reads correctly with no facility field at
 * all in that case.
 *
 * `includeAll` adds a leading "All facilities" option (value ''), for
 * use as a list filter. Without it the field opens on a disabled
 * placeholder until a real facility is chosen, for a required field
 * (making a code, adding an admin) or a Move action, where "nothing
 * chosen" must never read as a real answer.
 *
 * `variant` picks the field's look: 'field' (the default, a page's own
 * light form) or 'board' (the dark board at the top of a page, styled
 * like Activity's Who/What filters).
 */
export default function FacilityPicker({
  me, value, onChange, includeAll = false, required = false, label = 'Facility', variant = 'field',
}) {
  const [facilities, setFacilities] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (me.role !== 'owner') return
    let live = true
    listFacilities()
      .then((rows) => { if (live) setFacilities(rows) })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [me.role])

  if (me.role !== 'owner') return null

  return (
    <label className={variant === 'board' ? 'board-field' : 'field'}>
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={!facilities} required={required}>
        {includeAll && <option value="">All facilities</option>}
        {!includeAll && <option value="" disabled>Choose a facility</option>}
        {(facilities ?? []).map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
      </select>
      {error && <span className="row-error" role="alert">{error}</span>}
    </label>
  )
}
