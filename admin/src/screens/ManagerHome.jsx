import { Fragment, useEffect, useRef, useState } from 'react'
import FacilityLogo from '../components/FacilityLogo'
import Icon from '../components/Icon'
import BoardStrip from '../components/BoardStrip'
import PageBoard from '../components/PageBoard'
import PageTabs from '../components/PageTabs'
import SessionCard from '../components/SessionCard'
import { RowsSkeleton } from '../components/Skeleton'
import { AllClear, LeftOpenTable, MatchTable } from '../components/WorthALook'
import { fetchFacility, listPastSessions } from '../lib/api'
import { clockText, dayHeading, timeOfDay } from '../lib/format'
import {
  allTimeLine, managerDefaultTab, missingLine, needsFlag, placeFacts, sessionLine, sessionNeeds, sinceFor, umpireLine, waitingCount,
} from '../lib/managerHome'
import { Link } from '../lib/router'
import { useTabParam } from '../lib/tabParam'

/**
 * A manager's Overview: a number strip, then four tabs: what needs
 * them, what is live, finished sessions, and their place and umpires.
 * The Overview screen loads `data` and owns the row buttons' dialogs.
 */
export default function ManagerHome({ me, data, error, now, actions }) {
  const [facility, setFacility] = useState(null)
  const [facilityError, setFacilityError] = useState(null)
  const [past, setPast] = useState(null)
  const [pastError, setPastError] = useState(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [umpireId, setUmpireId] = useState('')
  const [when, setWhen] = useState('all')

  useEffect(() => {
    fetchFacility(me.facilityId).then((found) => setFacility(found.facility)).catch((err) => setFacilityError(err.message))
  }, [me.facilityId])

  // Which sessions are live or left open and which matches are voided. When
  // that changes the list starts again; the 30-second refresh alone leaves
  // "Show older sessions" where the manager left it.
  const sessionsKey = data
    ? [data.sessions.map((s) => s.id), data.leftOpen.map((s) => s.sessionId), data.warnings.filter((w) => w.voided).map((w) => w.matchId)].join('|')
    : null
  const loadedKey = useRef(null)
  const request = useRef(0)

  // The filters ride to the server, so "Show older sessions" pages through the filtered list.
  function loadPast(filters = { umpireId, when }) {
    const id = ++request.current
    listPastSessions({ umpireId: filters.umpireId || undefined, since: sinceFor(filters.when) })
      .then((page) => { if (request.current === id) { setPast(page); setPastError(null) } })
      .catch((err) => { if (request.current === id) setPastError(err.message) })
  }

  // The list does not wait for the Overview: it loads as the page opens.
  useEffect(() => loadPast(), [])

  useEffect(() => {
    if (sessionsKey === null) return
    // The first Overview answer only sets the starting point; a later change reloads.
    if (loadedKey.current !== null && loadedKey.current !== sessionsKey) loadPast()
    loadedKey.current = sessionsKey
  }, [sessionsKey])

  function filterBy(next) {
    setUmpireId(next.umpireId)
    setWhen(next.when)
    setPast(null)
    setPastError(null)
    loadPast(next)
  }

  async function showOlder() {
    // Reads the counter without raising it: a reload that starts while this is in flight wins.
    const id = request.current
    setLoadingOlder(true)
    try {
      const page = await listPastSessions({ before: past.next, umpireId: umpireId || undefined, since: sinceFor(when) })
      if (request.current !== id) return
      setPast((current) => ({ sessions: [...current.sessions, ...page.sessions], next: page.next }))
      setPastError(null)
    } catch (err) {
      if (request.current === id) setPastError(err.message)
    } finally {
      setLoadingOlder(false)
    }
  }

  const name = facility?.name ?? data?.facilityName ?? 'Your facility'
  const waiting = data ? waitingCount(data) : 0
  // An api that does not send the umpires yet must not blank the page.
  const umpires = data?.umpires ?? []
  const noUmpires = data != null && umpires.length === 0
  const missing = facility && missingLine(facility)
  const allTime = data && allTimeLine(data.totals)
  const [tab, setTab] = useTabParam(['needs', 'now', 'sessions', 'place'], data ? managerDefaultTab({ waiting, live: data.sessions.length }) : null)
  const current = tab ?? 'sessions'
  // Until the first answer picks a tab, show the skeleton rather than Sessions and then jump.
  const settling = tab === null && !error

  return (
    <section>
      <PageBoard
        title={<span className="home-title"><FacilityLogo name={name} logoUrl={facility?.logoUrl} />{name}</span>}
        intro={facility?.area}
      >
        {data && <div className="as-of">Up to date as of <b>{clockText(data.asOf)}</b></div>}
        {data?.totals.sessions.count === 0 ? (
          <p className="page-board-intro">Nothing has been scored here yet.</p>
        ) : (
          <BoardStrip
            loading={!data && !error}
            cellCount={5}
            cells={data ? [
              { key: 'live', label: 'Live now', figure: data.sessions.length, lit: data.sessions.length > 0 },
              { key: 'waiting', label: 'Waiting for you', figure: waiting },
              { key: 'matches', label: 'Matches this week', figure: data.totals.matches.newThisWeek },
              { key: 'sessions', label: 'Sessions this week', figure: data.totals.sessions.newThisWeek },
              { key: 'umpires', label: 'Umpires', figure: umpires.length },
            ] : []}
          />
        )}
      </PageBoard>

      <div className="sheet">
        {error && <p className="form-error" role="alert">{error}</p>}
        <PageTabs
          idPrefix="home"
          label="Overview"
          current={current}
          onChange={setTab}
          tabs={[
            { id: 'needs', label: 'Needs you', icon: 'alert', count: data ? waiting : null },
            { id: 'now', label: 'Scoring now', icon: 'live', count: data ? data.sessions.length : null },
            { id: 'sessions', label: 'Sessions', icon: 'calendar' },
            { id: 'place', label: 'Place & umpires', icon: 'pin' },
          ]}
        />
        <div id="home-panel" role="tabpanel" aria-labelledby={`home-tab-${current}`} aria-busy={!data || undefined}>
          {settling && <RowsSkeleton rows={4} />}

          {!settling && current === 'needs' && (!data ? (error ? null : <RowsSkeleton rows={4} />) : (
            <>
              {noUmpires && (
                <p className="notice home-invite">
                  No umpires yet.
                  <Link to="/umpires/invites" className="btn-primary btn-small"><Icon name="plus" size={15} />Make an invite code</Link>
                </p>
              )}
              {data.leftOpen.length > 0 && <LeftOpenTable sessions={data.leftOpen} actions={actions} />}
              {data.warnings.length > 0 && <MatchTable warnings={data.warnings} now={now} actions={actions} />}
              {!noUmpires && data.leftOpen.length === 0 && data.warnings.length === 0 && <AllClear title="All clear" text="" />}
            </>
          ))}

          {!settling && current === 'now' && (!data ? (error ? null : <RowsSkeleton rows={4} />) : (
            data.sessions.length === 0
              ? <p className="empty">Nothing live right now.</p>
              : data.sessions.map((session) => <SessionCard key={session.id} session={session} now={now} />)
          ))}

          {!settling && current === 'sessions' && (
            <>
              <div className="worth-filters">
                <label>
                  <span>Umpire</span>
                  <select value={umpireId} onChange={(e) => filterBy({ umpireId: e.target.value, when })}>
                    <option value="">Any</option>
                    {umpires.map((umpire) => <option key={umpire.id} value={umpire.id}>{umpire.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>When</span>
                  <select value={when} onChange={(e) => filterBy({ umpireId, when: e.target.value })}>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="all">Everything</option>
                  </select>
                </label>
              </div>
              {pastError && <p className="form-error" role="alert">{pastError}</p>}
              {!past && !pastError && <RowsSkeleton rows={5} />}
              {past?.sessions.length === 0 && <p className="empty">No sessions.</p>}
              {past?.sessions.length > 0 && (
                <div className="table-wrap">
                  <table className="table log">
                    <caption className="sr-only">Finished sessions, newest first</caption>
                    <tbody>
                      {past.sessions.map((session, index) => {
                        const needs = sessionNeeds(session.id, data?.warnings ?? [])
                        const day = dayHeading(session.startedAt, now)
                        const newDay = index === 0 || day !== dayHeading(past.sessions[index - 1].startedAt, now)
                        return (
                          <Fragment key={session.id}>
                            {newDay && <tr className="day-row"><th colSpan={3} scope="colgroup">{day}</th></tr>}
                            <tr>
                              <td className="col-when">{timeOfDay(session.startedAt)}</td>
                              <td>
                                <span className="cell-main"><strong>{session.name}</strong></span>
                                <span className="cell-sub">
                                  {sessionLine(session)}
                                  {session.openedBy && <> · <Icon name="clipboard" size={14} /><span className="sr-only">run by </span>{session.openedBy}</>}
                                </span>
                              </td>
                              <td className="home-flag">
                                {needs > 0 && (
                                  <span className="reason amber" role="img" aria-label={needsFlag(needs)} title={needsFlag(needs)}>
                                    <Icon name="alert" size={15} />{needs}
                                  </span>
                                )}
                              </td>
                            </tr>
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                  {past.next && (
                    <div className="table-foot">
                      <button type="button" className="btn-quiet btn-small" onClick={showOlder} disabled={loadingOlder}>
                        {loadingOlder ? 'Loading…' : 'Show older sessions'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {current === 'place' && (
            <div className="home-place">
              <div>
                <h2 className="section-title"><Icon name="pin" />Your place</h2>
                {facilityError && <p className="form-error" role="alert">{facilityError}</p>}
                {!facility && !facilityError && <RowsSkeleton rows={4} />}
                {facility && (
                  <>
                    <div className="detail-facts" style={{ '--fact-columns': 1 }}>
                      {placeFacts(facility).map((fact) => (
                        <div className="detail-fact" key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>
                      ))}
                    </div>
                    {missing && <p className="hint home-gap">{missing}</p>}
                    <Link to={`/facilities/${me.facilityId}`} className="btn-quiet btn-small home-gap"><Icon name="edit" size={15} />Edit details</Link>
                  </>
                )}
              </div>

              <div>
                <h2 className="section-title"><Icon name="clipboard" />Your umpires</h2>
                {!data && <RowsSkeleton rows={4} />}
                {data && (
                  <>
                    {noUmpires && <p className="hint">No umpires yet.</p>}
                    {umpires.length > 0 && (
                      <div className="detail-facts" style={{ '--fact-columns': 1 }}>
                        {umpires.map((umpire) => (
                          <div className="detail-fact" key={umpire.id}>
                            <strong><Link to={`/umpires/${umpire.id}`} className="row-link">{umpire.name}</Link>{umpire.paused && ' · Paused'}</strong>
                            <div className="cell-sub">{umpireLine(umpire, now)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Link to="/umpires/invites" className="btn-primary btn-small home-gap"><Icon name="plus" size={15} />Make an invite code</Link>
                    {allTime && <p className="hint home-gap">{allTime}</p>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
