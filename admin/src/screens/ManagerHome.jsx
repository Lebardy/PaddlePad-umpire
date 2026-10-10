import { Fragment, useEffect, useRef, useState } from 'react'
import FacilityLogo from '../components/FacilityLogo'
import Icon from '../components/Icon'
import PageBoard, { TallyCell } from '../components/PageBoard'
import PanelTabs from '../components/PanelTabs'
import SessionCard from '../components/SessionCard'
import { AllClear, LeftOpenTable, MatchTable } from '../components/WorthALook'
import { fetchFacility, listPastSessions } from '../lib/api'
import { clockText, dayHeading, timeOfDay } from '../lib/format'
import {
  allTimeLine, missingLine, needsFlag, placeFacts, sessionLine, sessionNeeds, umpireLastText, umpireWeekText, waitingCount,
} from '../lib/managerHome'
import { Link } from '../lib/router'

/**
 * A manager's Overview: their place and their umpires in a rail, and
 * one feed of what is live, what needs them, and finished sessions.
 * The Overview screen loads `data` and owns the row buttons' dialogs.
 */
export default function ManagerHome({ me, data, error, now, actions }) {
  const [facility, setFacility] = useState(null)
  const [facilityError, setFacilityError] = useState(null)
  const [past, setPast] = useState(null)
  const [pastError, setPastError] = useState(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [show, setShow] = useState('all')

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

  function loadPast() {
    const id = ++request.current
    listPastSessions()
      .then((page) => { if (request.current === id) { setPast(page); setPastError(null) } })
      .catch((err) => { if (request.current === id) setPastError(err.message) })
  }

  // The list does not wait for the Overview: it loads as the page opens.
  useEffect(loadPast, [])

  useEffect(() => {
    if (sessionsKey === null) return
    // The first Overview answer only sets the starting point; a later change reloads.
    if (loadedKey.current !== null && loadedKey.current !== sessionsKey) loadPast()
    loadedKey.current = sessionsKey
  }, [sessionsKey])

  async function showOlder() {
    // Reads the counter without raising it: a reload that starts while this is in flight wins.
    const id = request.current
    setLoadingOlder(true)
    try {
      const page = await listPastSessions({ before: past.next })
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
  const filters = [
    { id: 'all', label: 'Everything' },
    { id: 'needs', label: 'Needs you', count: waiting },
    { id: 'sessions', label: 'Sessions' },
  ]

  return (
    <section>
      <PageBoard
        title={<span className="home-title"><FacilityLogo name={name} logoUrl={facility?.logoUrl} />{name}</span>}
        intro={facility?.area}
      >
        {data && (
          <div className="board-head-group home-numbers">
            {data.totals.sessions.count === 0 ? (
              <p className="page-board-intro">Nothing has been scored here yet.</p>
            ) : (
              <div className="tally">
                <TallyCell figure={waiting} label="waiting for you" />
                <TallyCell figure={data.totals.matches.newThisWeek} label={`${data.totals.matches.newThisWeek === 1 ? 'match' : 'matches'} this week`} />
                <TallyCell figure={data.totals.sessions.newThisWeek} label={`${data.totals.sessions.newThisWeek === 1 ? 'session' : 'sessions'} this week`} />
              </div>
            )}
            <div className="as-of">Up to date as of <b>{clockText(data.asOf)}</b></div>
          </div>
        )}
      </PageBoard>

      <div className="sheet home-split">
        <aside className="home-rail">
          <div>
            <h2 className="section-title"><Icon name="pin" />Your place</h2>
            {facilityError && <p className="form-error" role="alert">{facilityError}</p>}
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
            {error && !data && <p className="form-error" role="alert">{error}</p>}
            {data && (
              <>
                {noUmpires && <p className="hint">No umpires yet.</p>}
                {umpires.length > 0 && (
                  <div className="detail-facts" style={{ '--fact-columns': 1 }}>
                    {umpires.map((umpire) => (
                      <div className="detail-fact" key={umpire.id}>
                        <strong><Link to={`/umpires/${umpire.id}`} className="row-link">{umpire.name}</Link>{umpire.paused && ' · Paused'}</strong>
                        <div className="cell-sub">{umpireWeekText(umpire)} · {umpireLastText(umpire, now)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <Link to="/umpires/invites" className="btn-primary btn-small home-gap"><Icon name="plus" size={15} />Make an invite code</Link>
                <p className="hint home-gap">{allTimeLine(data.totals)}</p>
              </>
            )}
          </div>
        </aside>

        <div className="home-feed">
          {error && <p className="form-error" role="alert">{error}</p>}
          {!data && !error && <p className="empty">Loading…</p>}
          {data && (
            <>
              <PanelTabs label="What to show" tabs={filters} current={show} onChange={setShow} />

              {show !== 'needs' && data.sessions.length > 0 && (
                <div>
                  <h2 className="section-title"><Icon name="live" />Scoring now</h2>
                  {data.sessions.map((session) => <SessionCard key={session.id} session={session} now={now} />)}
                </div>
              )}

              {show !== 'sessions' && (
                <div>
                  <h2 className="section-title">
                    <Icon name="alert" />Needs you{waiting > 0 && <span className="worth-count">{waiting}</span>}
                  </h2>
                  {noUmpires && (
                    <p className="notice home-invite">
                      No umpires yet.
                      <Link to="/umpires/invites" className="btn-primary btn-small"><Icon name="plus" size={15} />Make an invite code</Link>
                    </p>
                  )}
                  {data.leftOpen.length > 0 && <LeftOpenTable sessions={data.leftOpen} actions={actions} />}
                  {data.warnings.length > 0 && <MatchTable warnings={data.warnings} now={now} actions={actions} />}
                  {!noUmpires && data.leftOpen.length === 0 && data.warnings.length === 0 && <AllClear title="All clear" text="" />}
                </div>
              )}
            </>
          )}

          {show !== 'needs' && (
            <div>
              <h2 className="section-title"><Icon name="calendar" />Sessions</h2>
              {pastError && <p className="form-error" role="alert">{pastError}</p>}
              {!past && !pastError && <p className="empty">Loading…</p>}
              {past?.sessions.length === 0 && <p className="empty">No sessions yet.</p>}
              {past?.sessions.length > 0 && (
                <div className="table-wrap">
                  <table className="table log">
                    <caption className="sr-only">Finished sessions, newest first</caption>
                    <tbody>
                      {past.sessions.map((session, index) => {
                        const flag = needsFlag(sessionNeeds(session.id, data?.warnings ?? []))
                        const day = dayHeading(session.startedAt, now)
                        const newDay = index === 0 || day !== dayHeading(past.sessions[index - 1].startedAt, now)
                        return (
                          <Fragment key={session.id}>
                            {newDay && <tr className="day-row"><th colSpan={3} scope="colgroup">{day}</th></tr>}
                            <tr>
                              <td className="col-when">{timeOfDay(session.startedAt)}</td>
                              <td>
                                <span className="cell-main"><strong>{session.name}</strong></span>
                                <span className="cell-sub">{sessionLine(session)}</span>
                              </td>
                              <td>{flag && <span className="reason amber">{flag}</span>}</td>
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
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
