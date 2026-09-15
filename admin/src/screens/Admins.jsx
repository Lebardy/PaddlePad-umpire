import { useEffect, useState } from 'react'
import PageBoard, { TallyCell } from '../components/PageBoard'
import { addAdmin, listAdmins, newSetupLink, switchAdmin } from '../lib/api'
import { formatWhen, signInMethods } from '../lib/format'

const notSetUp = (admin) => !admin.hasPassword && !admin.googleEmail

/** Owner only: add admins, hand out setup links, switch admins off and on. */
export default function Admins({ me }) {
  const [admins, setAdmins] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)
  // Which admin's row is asking "are you sure?", and about what.
  const [confirming, setConfirming] = useState(null)

  useEffect(() => {
    let live = true
    listAdmins()
      .then((rows) => { if (live) setAdmins(rows) })
      .catch((err) => { if (live) setError(err.message) })
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
      const { admin, setupLink } = await addAdmin({ name: name.trim(), email: email.trim() })
      setLink({ forName: admin.name, ...setupLink })
      setCopied(false)
      setName('')
      setEmail('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleNewLink(admin) {
    setConfirming(null)
    try {
      setLink({ forName: admin.name, ...(await newSetupLink(admin.id)) })
      setCopied(false)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSwitch(admin) {
    setConfirming(null)
    try {
      await switchAdmin(admin.id, !admin.active)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
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
  const on = list.filter((a) => a.active).length

  function actions(admin) {
    if (admin.role === 'owner') return null
    if (confirming?.id === admin.id) {
      const switching = confirming.what === 'switch'
      const question = switching
        ? (admin.active ? 'They are signed out straight away.' : 'They can sign in again straight away.')
        : 'Any unused link they have stops working.'
      return (
        <span className="confirm">
          <span className="confirm-text">{question}</span>
          <span className="confirm-buttons">
            {switching
              ? <button type="button" className={`btn-small ${admin.active ? 'btn-danger is-solid' : 'btn-primary'}`} onClick={() => handleSwitch(admin)}>{admin.active ? 'Switch off' : 'Switch on'}</button>
              : <button type="button" className="btn-primary btn-small" onClick={() => handleNewLink(admin)}>Make link</button>}
            {/* Focus lands on the safe choice. */}
            <button type="button" className="btn-quiet btn-small" autoFocus onClick={() => setConfirming(null)}>Not now</button>
          </span>
        </span>
      )
    }
    return (
      <>
        {admin.active && <button type="button" className="btn-quiet btn-small" onClick={() => setConfirming({ id: admin.id, what: 'link' })}>New setup link</button>}
        <button type="button" className={`btn-small ${admin.active ? 'btn-danger' : 'btn-quiet'}`} onClick={() => setConfirming({ id: admin.id, what: 'switch' })}>
          {admin.active ? 'Switch off' : 'Switch on'}
        </button>
      </>
    )
  }

  return (
    <section>
      <PageBoard
        title="Admins"
        intro="Only you, as the owner, can see this page. A new admin gets a setup link from you and chooses their own password."
      >
        <div className="tally">
          <TallyCell figure={admins ? list.length : '–'} label="Admins" />
          <TallyCell figure={admins ? on : '–'} label="Switched on" />
          <TallyCell figure={admins ? list.length - on : '–'} label="Switched off" />
          <TallyCell figure={admins ? list.filter(notSetUp).length : '–'} label="Not set up" />
        </div>
      </PageBoard>

      <div className="sheet">
        <form className="form-strip" onSubmit={handleAdd}>
          <h2 className="form-strip-title">Add an admin</h2>
          <label className="field grow"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="field grow"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add admin'}</button>
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
              <button type="button" className="btn-lamp" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
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
                    <td>
                      {notSetUp(admin)
                        ? <span className="tag tag-waiting">{signInMethods(admin)}</span>
                        : <span className="cell-main">{signInMethods(admin)}</span>}
                    </td>
                    <td className="col-when">{admin.lastSignedInAt ? formatWhen(admin.lastSignedInAt) : 'Never'}</td>
                    <td className="col-when"><span className={`tag ${admin.active ? 'tag-on' : 'tag-off'}`}>{admin.active ? 'On' : 'Off'}</span></td>
                    <td className="row-actions">{actions(admin)}</td>
                  </tr>
                ))}
              </tbody>
              {list.length === 1 && (
                <tfoot>
                  <tr><td colSpan={5} className="table-foot">Only you so far. Add an admin above, then send them their setup link.</td></tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
