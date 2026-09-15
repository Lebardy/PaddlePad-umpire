import { Fragment, useEffect, useState } from 'react'
import PageBoard from '../components/PageBoard'
import { activityFilters, listActivity } from '../lib/api'
import { actionLabel } from '../lib/format'

// Manila, like every other time on the admin site, so a day break falls
// at the same moment for every admin.
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric' })
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
const dayOf = (iso) => DAY.format(new Date(iso))
const timeOf = (iso) => TIME.format(new Date(iso)).replace(/\s+/g, ' ')

const WARNINGS = new Set(['admin.sign_in_failed', 'admin.switched_off'])

/** Entries in order, split into days: [{ day, entries }]. */
function byDay(entries) {
  const days = []
  for (const entry of entries) {
    const day = dayOf(entry.createdAt)
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] })
    days.at(-1).entries.push(entry)
  }
  return days
}

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

  function choose(set, value) {
    setEntries(null)
    set(value)
  }

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
      <PageBoard title="Activity" intro="Everything an admin has done, newest first. Entries can’t be changed or deleted.">
        <div className="board-fields">
          <label className="board-field">
            <span>Who</span>
            <select value={adminId} onChange={(e) => choose(setAdminId, e.target.value)}>
              <option value="">Everyone</option>
              {filters.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="board-field">
            <span>What</span>
            <select value={action} onChange={(e) => choose(setAction, e.target.value)}>
              <option value="">Everything</option>
              {filters.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </select>
          </label>
        </div>
      </PageBoard>

      <div className="sheet">
        {error && <p className="form-error" role="alert">{error}</p>}
        {entries === null && !error && <p className="empty">Loading…</p>}
        {entries?.length === 0 && <p className="empty">Nothing recorded for this choice.</p>}

        {entries?.length > 0 && (
          <div className="table-wrap">
            <table className="table log">
              <thead>
                <tr><th className="col-when">Time</th><th>Who</th><th>What</th><th>Details</th></tr>
              </thead>
              <tbody>
                {byDay(entries).map(({ day, entries: dayEntries }) => (
                  <Fragment key={day}>
                    <tr className="day-row">
                      <th colSpan={4} scope="colgroup">{day}</th>
                    </tr>
                    {dayEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="col-when">{timeOf(entry.createdAt)}</td>
                        <td>{entry.adminName ?? 'Setup command'}</td>
                        <td><span className={`what${WARNINGS.has(entry.action) ? ' is-warning' : ''}`}>{actionLabel(entry.action)}</span></td>
                        <td><span className="cell-main">{entry.summary}</span></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <div className="table-foot">
              <span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'} shown.{nextBefore ? '' : ' That’s all of them.'}</span>
              {nextBefore && (
                <button type="button" className="btn-quiet btn-small" onClick={showOlder} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Show older'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
