import { useEffect, useRef, useState } from 'react'
import FacilityPicker from '../components/FacilityPicker'
import PageBoard from '../components/PageBoard'
import StatusTag from '../components/StatusTag'
import UmpireTabs from '../components/UmpireTabs'
import { listPlayers, listUmpires } from '../lib/api'
import { formatWhen, lastSignedInText, signInMethodsText } from '../lib/format'
import { navigate } from '../lib/navigation'
import { Link } from '../lib/router'

const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'closed', label: 'Closed' },
]

const KIND = {
  players: {
    list: listPlayers,
    title: 'Players',
    intro: 'Everyone who plays on PaddlePad. Open someone to see their details, pause their account or make a new claim code.',
    searchLabel: 'Search by name, username or email',
    emptyAll: 'No players yet.',
    detailPath: (id) => `/players/${id}`,
  },
  umpires: {
    list: listUmpires,
    title: 'Umpires',
    intro: 'The umpires who score matches. Open someone to see their details or pause their account; new umpires join with an invite code.',
    searchLabel: 'Search by name or email',
    emptyAll: 'No umpires yet.',
    detailPath: (id) => `/umpires/${id}`,
  },
}

/** The Players page and the Umpires page's list: searched and filtered the same way. */
export default function People({ kind, me }) {
  const config = KIND[kind]
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [facilityId, setFacilityId] = useState('')
  const [rows, setRows] = useState(null)
  const [next, setNext] = useState(null)
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Bumped on every new search or filter, so a page still loading for an
  // old one is recognised as stale and ignored, the way Activity does it.
  const requestId = useRef(0)

  // Waits until typing stops before searching.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300)
    return () => clearTimeout(timer)
  }, [typed])

  // Players belong to no facility, so the filter (and the column it
  // scopes) exists only for umpires -- sending it for players would
  // just be ignored server-side, but there is nothing to filter by.
  const facilityFilter = kind === 'umpires' ? facilityId : undefined

  useEffect(() => {
    const id = ++requestId.current
    config.list({ q, status, facilityId: facilityFilter })
      .then((data) => {
        if (requestId.current !== id) return
        setRows(data[kind])
        setNext(data.next)
        setError(null)
      })
      .catch((err) => { if (requestId.current === id) setError(err.message) })
  }, [kind, q, status, facilityFilter, config])

  // A new status or facility starts loading again straight away, from
  // the event that changed it rather than from inside the effect above.
  // A new search instead keeps the current rows on screen until the
  // debounced request lands, so the table doesn't blank out on every
  // keystroke.
  function updateStatus(value) {
    setRows(null)
    setStatus(value)
  }

  function updateFacility(value) {
    setRows(null)
    setFacilityId(value)
  }

  async function showMore() {
    const id = requestId.current
    setLoadingMore(true)
    try {
      const data = await config.list({ q, status, after: next, facilityId: facilityFilter })
      if (requestId.current !== id) return
      setRows((current) => [...(current ?? []), ...data[kind]])
      setNext(data.next)
    } catch (err) {
      if (requestId.current === id) setError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const emptyMessage = rows && rows.length === 0
    ? (q || status !== 'all' ? 'No one matches that.' : config.emptyAll)
    : null

  return (
    <section>
      <PageBoard title={config.title} intro={config.intro} />

      <div className="sheet">
        {kind === 'umpires' && <UmpireTabs current="umpires" />}

        <div className="form-strip">
          <label className="field grow">
            <span>{config.searchLabel}</span>
            <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <fieldset className="cells">
            <legend>Status</legend>
            {STATUSES.map((s) => (
              <label key={s.key}>
                <input type="radio" name={`status-${kind}`} value={s.key} checked={status === s.key} onChange={() => updateStatus(s.key)} />
                {s.label}
              </label>
            ))}
          </fieldset>
          {kind === 'umpires' && <FacilityPicker me={me} value={facilityId} onChange={updateFacility} includeAll />}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {rows === null && !error && <p className="empty">Loading…</p>}
        {emptyMessage && <p className="empty">{emptyMessage}</p>}

        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Ways in</th>
                  {kind === 'umpires' && me.role === 'owner' && <th>Facility</th>}
                  <th className="col-when">Joined</th>
                  <th className="col-when">Last signed in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => (
                  <tr key={person.id} className="row-clickable" onClick={() => navigate(config.detailPath(person.id))}>
                    <td>
                      <span className="cell-main name-line">
                        <Link to={config.detailPath(person.id)} className="row-link"><strong>{person.name}</strong></Link>
                        {kind === 'players' && !person.claimed && <span className="tag tag-waiting">Not claimed</span>}
                      </span>
                      {kind === 'players'
                        ? person.username && <span className="cell-sub">{person.username}</span>
                        : <span className="cell-sub">{person.email}</span>}
                    </td>
                    <td>{signInMethodsText(person.signInMethods)}</td>
                    {kind === 'umpires' && me.role === 'owner' && <td>{person.facilityName ?? '—'}</td>}
                    <td className="col-when">{formatWhen(person.joinedAt)}</td>
                    <td className="col-when">{lastSignedInText(person.lastSignedInAt)}</td>
                    <td><StatusTag status={person.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {next && (
              <div className="table-foot">
                <span>{rows.length} shown.</span>
                <button type="button" className="btn-quiet btn-small" onClick={showMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Show more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
