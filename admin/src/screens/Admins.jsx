import { useEffect, useState } from 'react'
import { addAdmin, listAdmins, newSetupLink, switchAdmin } from '../lib/api'
import { formatWhen, signInMethods } from '../lib/format'

/** Owner only: add admins, hand out setup links, switch admins off and on. */
export default function Admins({ me }) {
  const [admins, setAdmins] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)

  async function refresh() {
    try {
      setAdmins(await listAdmins())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { refresh() }, [])

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
    if (!window.confirm(`Make a new setup link for ${admin.name}? Any unused link they have stops working.`)) return
    try {
      setLink({ forName: admin.name, ...(await newSetupLink(admin.id)) })
      setCopied(false)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSwitch(admin) {
    const on = !admin.active
    const question = on ? `Switch ${admin.name} back on?` : `Switch ${admin.name} off? They are signed out straight away.`
    if (!window.confirm(question)) return
    try {
      await switchAdmin(admin.id, on)
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

  return (
    <section>
      <header className="page-head">
        <h1>Admins</h1>
        <p>Only you, as the owner, can see this page. A new admin gets a setup link from you and chooses their own password.</p>
      </header>

      <form className="toolbar" onSubmit={handleAdd}>
        <label className="field grow"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field grow"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add admin'}</button>
      </form>

      {link && (
        <div className="notice" role="status">
          <p><strong>Setup link for {link.forName}.</strong> Send it to them yourself. It works once and stops working {formatWhen(link.expiresAt)}.</p>
          <div className="link-row">
            <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Setup link" />
            <button type="button" className="btn-quiet" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" className="btn-quiet" onClick={() => setLink(null)}>Done</button>
          </div>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {admins === null && !error && <p className="empty">Loading…</p>}

      {admins?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Signs in with</th><th>Last signed in</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id} className={admin.active ? '' : 'is-faded'}>
                  <td><strong>{admin.name}</strong>{admin.id === me.id && ' (you)'}</td>
                  <td>{admin.email}</td>
                  <td>{admin.role === 'owner' ? 'Owner' : 'Admin'}</td>
                  <td>{signInMethods(admin)}</td>
                  <td>{formatWhen(admin.lastSignedInAt)}</td>
                  <td><span className={`tag ${admin.active ? 'tag-open' : 'tag-off'}`}>{admin.active ? 'On' : 'Off'}</span></td>
                  <td className="row-actions">
                    {admin.role !== 'owner' && (
                      <>
                        {admin.active && <button type="button" className="btn-quiet" onClick={() => handleNewLink(admin)}>New setup link</button>}
                        <button type="button" className={admin.active ? 'btn-danger' : 'btn-quiet'} onClick={() => handleSwitch(admin)}>
                          {admin.active ? 'Switch off' : 'Switch on'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
