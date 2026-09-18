import { Fragment, useEffect, useRef, useState } from 'react'
import PageBoard from '../components/PageBoard'
import { activityFilters, listActivity } from '../lib/api'
import { actionLabel, dayHeading, timeOfDay } from '../lib/format'

// The heading (dayHeading) can read the same for two different days a
// year apart when neither is this year, so the grouping key is its own
// Manila year+month+day, not the label itself.
const DAY_KEY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric' })

const WARNINGS = new Set(['admin.sign_in_failed', 'admin.switched_off'])

/** Entries in order, split into days: [{ day, entries }]. */
function byDay(entries) {
  const days = []
  for (const entry of entries) {
    const key = DAY_KEY.format(new Date(entry.createdAt))
    if (days.at(-1)?.key !== key) days.push({ key, day: dayHeading(entry.createdAt), entries: [] })
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

  // Bumped by every filter change and read back when a request lands,
  // so a "Show older" still in flight for the old filter is recognised
  // as stale and ignored rather than appended onto the new list.
  const requestId = useRef(0)

  useEffect(() => {
    activityFilters().then(setFilters).catch(() => {})
  }, [])

  // A new filter starts again from the newest entry.
  useEffect(() => {
    const id = ++requestId.current
    listActivity({ adminId, action })
      .then((data) => {
        if (requestId.current !== id) return
        setEntries(data.entries)
        setNextBefore(data.nextBefore)
        setError(null)
      })
      .catch((err) => { if (requestId.current === id) setError(err.message) })
  }, [adminId, action])

  function choose(set, value) {
    setEntries(null)
    set(value)
  }

  async function showOlder() {
    const id = requestId.current
    setLoadingMore(true)
    try {
      const data = await listActivity({ before: nextBefore, adminId, action })
      if (requestId.current !== id) return
      setEntries((current) => [...(current ?? []), ...data.entries])
      setNextBefore(data.nextBefore)
    } catch (err) {
      if (requestId.current === id) setError(err.message)
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
                {byDay(entries).map(({ key, day, entries: dayEntries }) => (
                  <Fragment key={key}>
                    <tr className="day-row">
                      <th colSpan={4} scope="colgroup">{day}</th>
                    </tr>
                    {dayEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="col-when">{timeOfDay(entry.createdAt)}</td>
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
