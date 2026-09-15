import { useEffect, useState } from 'react'
import { activityFilters, listActivity } from '../lib/api'
import { actionLabel, formatWhen } from '../lib/format'

export default function Activity() {
  const [entries, setEntries] = useState(null)
  const [nextBefore, setNextBefore] = useState(null)
  const [filters, setFilters] = useState({ admins: [], actions: [] })
  const [adminId, setAdminId] = useState('')
  const [action, setAction] = useState('')
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    activityFilters().then(setFilters).catch(() => {})
  }, [])

  // A new filter starts again from the newest entry.
  useEffect(() => {
    let live = true
    setEntries(null)
    listActivity({ adminId, action })
      .then((data) => {
        if (!live) return
        setEntries(data.entries)
        setNextBefore(data.nextBefore)
        setError(null)
      })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [adminId, action])

  async function showOlder() {
    setLoadingMore(true)
    try {
      const data = await listActivity({ before: nextBefore, adminId, action })
      setEntries((current) => [...current, ...data.entries])
      setNextBefore(data.nextBefore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section>
      <header className="page-head">
        <h1>Activity</h1>
        <p>Everything an admin has done, newest first. Entries can’t be changed or deleted.</p>
      </header>

      <div className="toolbar">
        <label className="field">
          <span>Who</span>
          <select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
            <option value="">Everyone</option>
            {filters.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>What</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Everything</option>
            {filters.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {entries === null && !error && <p className="empty">Loading…</p>}
      {entries?.length === 0 && <p className="empty">Nothing recorded for this choice.</p>}

      {entries?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatWhen(entry.createdAt)}</td>
                  <td>{entry.adminName ?? 'Setup command'}</td>
                  <td>{actionLabel(entry.action)}</td>
                  <td>{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextBefore && (
        <button type="button" className="btn-quiet more" onClick={showOlder} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older'}
        </button>
      )}
    </section>
  )
}
