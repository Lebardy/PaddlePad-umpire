import { useCallback, useEffect, useState } from 'react'
import CloseSessionDialog from '../components/CloseSessionDialog'
import DuplicatePlayers from '../components/DuplicatePlayers'
import FacilityPicker from '../components/FacilityPicker'
import LiveBoard from '../components/LiveBoard'
import MergeDialog from '../components/MergeDialog'
import SessionCard from '../components/SessionCard'
import Totals from '../components/Totals'
import VoidDialog from '../components/VoidDialog'
import WorthALook from '../components/WorthALook'
import { fetchOverview, markLooksFine, markNotSamePerson, unvoidMatch } from '../lib/api'
import { clockText } from '../lib/format'

const REFRESH_MS = 30_000

/** The landing page: what's going on right now, the totals, and anything worth a look. */
export default function Overview({ me, facilityLabel }) {
  const isOwner = me.role === 'owner'
  const [facilityId, setFacilityId] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Everything a pop-up or a row action touches lives apart from `data`,
  // so the 30-second refresh never closes an open dialog or wipes a
  // typed reason.
  const [voiding, setVoiding] = useState(null)
  const [merging, setMerging] = useState(null)
  const [closingSession, setClosingSession] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [rowErrors, setRowErrors] = useState({})

  const load = useCallback(() => {
    return fetchOverview({ facilityId: isOwner ? facilityId : undefined })
      .then((next) => { setData(next); setNow(Date.now()); setError(null) })
      .catch((err) => setError(err.message))
  }, [isOwner, facilityId])

  useEffect(() => {
    load()
    // A hidden tab skips its tick rather than re-running the owner's
    // expensive duplicate-player scan for nobody to see; once the tab is
    // looked at again, we catch up with a single reload if one was missed.
    let missedWhileHidden = false
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
      else missedWhileHidden = true
    }, REFRESH_MS)
    function onVisible() {
      if (document.visibilityState === 'visible' && missedWhileHidden) {
        missedWhileHidden = false
        load()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  function clearRowError(key) {
    setRowErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function looksFine(matchId, reason) {
    setBusyId(matchId)
    clearRowError(matchId)
    try {
      await markLooksFine(matchId, reason)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [matchId]: err.message }))
    } finally {
      setBusyId(null)
    }
  }

  async function undo(matchId) {
    setBusyId(matchId)
    clearRowError(matchId)
    try {
      await unvoidMatch(matchId)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [matchId]: err.message }))
    } finally {
      setBusyId(null)
    }
  }

  async function notSame(pair) {
    const key = `${pair.a.id}:${pair.b.id}`
    setBusyKey(key)
    clearRowError(key)
    try {
      await markNotSamePerson(pair.a.id, pair.b.id)
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: err.message }))
    } finally {
      setBusyKey(null)
    }
  }

  const warningActions = {
    looksFine, undo, openVoid: setVoiding, openClose: setClosingSession, busyId, errors: rowErrors,
  }
  const duplicateActions = { notSame, openMerge: setMerging, busyKey, errors: rowErrors }

  if (!isOwner && !me.facilityId) {
    return <section className="sheet"><p className="empty missing">You’re not linked to a facility yet. Ask the owner.</p></section>
  }

  const showFacility = isOwner && !facilityId
  return (
    <section>
      <header className="board-texture">
        <div className="overview-head">
          <div>
            <h1>Overview</h1>
            <p>
              {isOwner && !facilityId
                ? <>What’s happening <strong>at every facility</strong> right now, the totals, and anything worth a look.</>
                : <>What’s going on at <strong>{data?.facilityName ?? facilityLabel ?? 'your facility'}</strong> right now, the totals, and anything worth a look.</>}
            </p>
          </div>
          <div className="board-head-group">
            <FacilityPicker me={me} value={facilityId} onChange={setFacilityId} includeAll variant="board" />
            {data && <div className="as-of">Up to date as of <b>{clockText(data.asOf)}</b> · refreshes every 30 s</div>}
          </div>
        </div>
        {data && <LiveBoard live={data.live} />}
      </header>

      <div className="sheet">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data && !error && <p className="empty">Loading…</p>}
        {data && (
          <>
            <div className="sheet-split">
              <div>
                <div className="section-head"><h2 className="section-title">Right now</h2>
                  {data.sessions.length > 0 && <span className="section-count">Newest session first</span>}</div>
                {data.sessions.length === 0
                  ? <div className="empty-board"><strong>Nothing going on right now</strong><span>No session is open.</span></div>
                  : data.sessions.map((s) => <SessionCard key={s.id} session={s} showFacility={showFacility} now={now} />)}
              </div>
              <aside>
                <div className="section-head"><h2 className="section-title">Totals</h2></div>
                <Totals totals={data.totals} isOwner={isOwner} facilityName={data.facilityName} />
              </aside>
            </div>
            <WorthALook warnings={data.warnings} leftOpen={data.leftOpen} isOwner={showFacility} now={now} actions={warningActions} />
            {data.duplicates && <DuplicatePlayers pairs={data.duplicates} now={now} actions={duplicateActions} />}
          </>
        )}
      </div>

      {voiding && (
        <VoidDialog warning={voiding} onCancel={() => setVoiding(null)} onDone={async () => { setVoiding(null); await load() }} />
      )}
      {merging && (
        <MergeDialog pair={merging} onCancel={() => setMerging(null)} onDone={async () => { setMerging(null); await load() }} />
      )}
      {closingSession && (
        <CloseSessionDialog
          session={closingSession}
          onCancel={() => setClosingSession(null)}
          onDone={async () => { setClosingSession(null); await load() }}
        />
      )}
    </section>
  )
}
