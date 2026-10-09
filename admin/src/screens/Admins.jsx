import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import FacilityPicker from '../components/FacilityPicker'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import StatusTag from '../components/StatusTag'
import { addAdmin, listAdmins, listFacilities, moveAdmin, newSetupLink, switchAdmin } from '../lib/api'
import { formatWhen, signInMethods } from '../lib/format'

const notSetUp = (admin) => !admin.hasPassword && !admin.googleEmail

/** Owner only: add admins, hand out setup links, pause and resume admins, and move them between facilities. */
export default function Admins({ me }) {
  const [admins, setAdmins] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [facilityId, setFacilityId] = useState('')
  const [facilitiesById, setFacilitiesById] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)
  // Which admin's row is asking "are you sure?", and about what.
  const [confirming, setConfirming] = useState(null)
  const [moveFacilityId, setMoveFacilityId] = useState('')

  useEffect(() => {
    let live = true
    listAdmins()
      .then((rows) => { if (live) setAdmins(rows) })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [])

  // The admin list carries only a facilityId, so the table's own
  // Facility column resolves it against every facility's name.
  useEffect(() => {
    let live = true
    listFacilities()
      .then((rows) => { if (live) setFacilitiesById(Object.fromEntries(rows.map((f) => [f.id, f.name]))) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  async function refresh() {
    try {
      setAdmins(await listAdmins())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAdd(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { admin, setupLink } = await addAdmin({ name: name.trim(), email: email.trim(), facilityId })
      setLink({ forName: admin.name, ...setupLink })
      setCopied(false)
      setName('')
      setEmail('')
      setFacilityId('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Errors are thrown back to the row's confirmation, which shows them there.
  async function handleNewLink(admin) {
    setLink({ forName: admin.name, ...(await newSetupLink(admin.id)) })
    setCopied(false)
  }

  async function handleSwitch(admin) {
    await switchAdmin(admin.id, !admin.active)
    await refresh()
  }

  // Errors are thrown back to the row's confirmation, which shows them there.
  async function handleMove(admin) {
    await moveAdmin(admin.id, moveFacilityId)
    setMoveFacilityId('')
    await refresh()
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setError('Couldn’t copy automatically. Select the link and copy it by hand.')
    }
  }

  const list = admins ?? []
  const active = list.filter((a) => a.active).length

  function actions(admin) {
    if (admin.role === 'owner') return null
    const asking = confirming?.id === admin.id ? confirming.what : null
    const close = () => setConfirming(null)
    return (
      <>
        {admin.active && (
          <RowConfirm
            label="New setup link"
            className="btn-quiet btn-small"
            question="Any unused link they have stops working."
            confirmLabel="Make link"
            busyLabel="Making…"
            confirmClass="btn-primary btn-small"
            keepLabel="Not now"
            open={asking === 'link'}
            hidden={asking === 'switch' || asking === 'move'}
            onOpen={() => setConfirming({ id: admin.id, what: 'link' })}
            onClose={close}
            onConfirm={() => handleNewLink(admin)}
          />
        )}
        <RowConfirm
          label="Move"
          className="btn-quiet btn-small"
          question={<FacilityPicker me={me} value={moveFacilityId} onChange={setMoveFacilityId} label="Move to" />}
          confirmLabel="Move"
          busyLabel="Moving…"
          confirmClass="btn-primary btn-small"
          keepLabel="Not now"
          open={asking === 'move'}
          hidden={asking === 'link' || asking === 'switch'}
          disabled={asking === 'move' && !moveFacilityId}
          onOpen={() => { setMoveFacilityId(''); setConfirming({ id: admin.id, what: 'move' }) }}
          onClose={close}
          onConfirm={() => handleMove(admin)}
        />
        <RowConfirm
          label={admin.active ? 'Pause' : 'Resume'}
          className={`btn-small ${admin.active ? 'btn-danger' : 'btn-quiet'}`}
          question={admin.active ? 'They are signed out straight away.' : 'They can sign in again straight away.'}
          confirmLabel={admin.active ? 'Pause' : 'Resume'}
          busyLabel={admin.active ? 'Pausing…' : 'Resuming…'}
          confirmClass={`btn-small ${admin.active ? 'btn-danger is-solid' : 'btn-primary'}`}
          keepLabel="Not now"
          open={asking === 'switch'}
          hidden={asking === 'link' || asking === 'move'}
          onOpen={() => setConfirming({ id: admin.id, what: 'switch' })}
          onClose={close}
          onConfirm={() => handleSwitch(admin)}
        />
      </>
    )
  }

  return (
    <section>
      <PageBoard
        title="Admins"
        intro="Only the owner sees this page. A new admin gets a setup link and picks their own password."
      >
        <div className="tally">
          <TallyCell figure={admins ? list.length : '–'} label="Admins" />
          <TallyCell figure={admins ? active : '–'} label="Active" />
          <TallyCell figure={admins ? list.length - active : '–'} label="Paused" />
          <TallyCell figure={admins ? list.filter(notSetUp).length : '–'} label="Not set up" />
        </div>
      </PageBoard>

      <div className="sheet">
        <form className="form-strip" onSubmit={handleAdd}>
          <h2 className="form-strip-title">Add an admin</h2>
          <label className="field grow"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="field grow"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <FacilityPicker me={me} value={facilityId} onChange={setFacilityId} required />
          <button type="submit" className="btn-primary" disabled={busy}><Icon name="plus" size={16} />{busy ? 'Adding…' : 'Add admin'}</button>
        </form>

        {link && (
          <div className="ticket board-texture" role="status">
            <div>
              <p className="ticket-text">
                <strong>Setup link for {link.forName}.</strong> Send it to them yourself. It works once and stops working {formatWhen(link.expiresAt)}.
              </p>
              <input className="link-field" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Setup link" />
            </div>
            <div className="ticket-actions">
              <button type="button" className="btn-lamp" onClick={copyLink}><Icon name="copy" size={16} />{copied ? 'Copied' : 'Copy link'}</button>
              <button type="button" className="btn-board" onClick={() => setLink(null)}>Done</button>
            </div>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        {admins === null && !error && <p className="empty">Loading…</p>}
        {admins?.length === 0 && <p className="empty">No admins yet.</p>}

        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Facility</th>
                  <th>Signs in with</th>
                  <th className="col-when">Last signed in</th>
                  <th className="col-when">Status</th>
                  <th className="col-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((admin) => (
                  <tr key={admin.id} className={admin.active ? '' : 'is-faded'}>
                    <td>
                      <span className="cell-main"><strong>{admin.name}</strong>{admin.id === me.id && ' (you)'}</span>
                      <span className="cell-sub">{admin.email} · {admin.role === 'owner' ? 'Owner' : 'Admin'}</span>
                    </td>
                    <td>{admin.role === 'owner' ? 'All facilities' : (facilitiesById[admin.facilityId] ?? '—')}</td>
                    <td>
                      {notSetUp(admin)
                        ? <span className="tag tag-waiting">{signInMethods(admin)}</span>
                        : <span className="cell-main">{signInMethods(admin)}</span>}
                    </td>
                    <td className="col-when">{admin.lastSignedInAt ? formatWhen(admin.lastSignedInAt) : 'Never'}</td>
                    <td className="col-when"><StatusTag status={admin.active ? 'active' : 'paused'} /></td>
                    <td className="row-actions">{actions(admin)}</td>
                  </tr>
                ))}
              </tbody>
              {list.length === 1 && (
                <tfoot>
                  <tr><td colSpan={6} className="table-foot">Only you so far. Add an admin above, then send them their setup link.</td></tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
