import { useRef, useState } from 'react'
import FacilityLogo from './FacilityLogo'
import RowConfirm from './RowConfirm'
import { removeFacilityLogo, uploadFacilityLogo } from '../lib/api'
import { pickProblem, prepareLogo } from '../lib/logoImage'

/** A facility's logo with Upload / Replace / Remove, on its page. */
export default function LogoEditor({ facility, onChange }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)

  async function handlePick(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // so picking the same file again still fires
    if (!file) return
    const problem = pickProblem(file)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError(null)
    try {
      let logo
      try {
        logo = await prepareLogo(file)
      } catch {
        throw new Error('That picture couldn’t be read. Try another file.')
      }
      onChange(await uploadFacilityLogo(facility.id, logo))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="logo-editor">
      <FacilityLogo name={facility.name} logoUrl={facility.logoUrl} size="lg" />
      <div className="logo-actions">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handlePick} />
        <div className="row-actions">
          <button type="button" className="btn-quiet btn-small" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : facility.logoUrl ? 'Replace' : 'Upload logo'}
          </button>
          {facility.logoUrl && !busy && (
            <RowConfirm
              label="Remove"
              className="btn-quiet btn-small"
              question="Take the logo off?"
              confirmLabel="Remove"
              busyLabel="Removing…"
              confirmClass="btn-danger btn-small"
              open={confirming}
              onOpen={() => setConfirming(true)}
              onClose={() => setConfirming(false)}
              onConfirm={async () => onChange(await removeFacilityLogo(facility.id))}
            />
          )}
        </div>
        <p className="hint">PNG, JPEG or WebP, up to 10 MB. It’s shrunk to fit 512 × 512.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
