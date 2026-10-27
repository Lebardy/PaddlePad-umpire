import { useCallback, useEffect, useState } from 'react'
import CloseSessionDialog from '../components/CloseSessionDialog'
import FacilityPicker from '../components/FacilityPicker'
import BoardStrip from '../components/BoardStrip'
import MergeDialog from '../components/MergeDialog'
import SessionCard from '../components/SessionCard'
import PageTabs from '../components/PageTabs'
import { Ghost, RowsSkeleton } from '../components/Skeleton'
import VoidDialog from '../components/VoidDialog'
import WorthALook from '../components/WorthALook'
import { fetchOverview, markLooksFine, markNotSamePerson, unvoidMatch } from '../lib/api'
import { clockText } from '../lib/format'
import { useTabParam } from '../lib/tabParam'
import { ownerCells, worthChips } from '../lib/worthFilters'
import ManagerHome from './ManagerHome'

const REFRESH_MS = 30_000

/** The landing page: a number strip, then what's going on right now and anything worth a look in two tabs. */
export default function Overview({ me, facilityLabel }) {
  const isOwner = me.role === 'owner'
  const [facilityId, setFacilityId] = useState('')
  const [data, setData] = useState(null)
  // Which facility `data` is for: a switch shows ghosts, the 30-second refresh does not.
  const [dataFor, setDataFor] = useState(null)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const loading = !data || dataFor !== facilityId
  // Open on what is happening if anything is, else on what needs a look.
  const [tab, setTab] = useTabParam(['now', 'look'], loading ? null : data.live.sessions > 0 ? 'now' : 'look')

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
      .then((next) => { setData(next); setDataFor(facilityId); setNow(Date.now()); setError(null) })
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

  // The pop-ups a row's button opens, shared by the owner's page and a manager's.
  const dialogs = (
    <>
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
    </>
  )

  // A manager's Overview is their own page; everything below is the owner's.
  if (!isOwner) {
    return <><ManagerHome me={me} data={data} error={error} now={now} actions={warningActions} />{dialogs}</>
  }

  const showFacility = isOwner && !facilityId
  return (
    <section>
      <header className="board-texture overview-board">
        <div className="overview-head">
          <div>
            <h1>Overview</h1>
            <p>
              {isOwner && !facilityId
                ? <><strong>Every facility</strong>, right now.</>
                : <><strong>{data?.facilityName ?? facilityLabel ?? 'Your facility'}</strong>, right now.</>}
            </p>
          </div>
          <div className="board-head-group">
            <FacilityPicker me={me} value={facilityId} onChange={setFacilityId} includeAll variant="board" />
            <div className="as-of">{data ? <>Up to date as of <b>{clockText(data.asOf)}</b> · refreshes every 30 s</> : <Ghost variant="label" style={{ width: '14rem' }} />}</div>
          </div>
        </div>
        <BoardStrip loading={loading && !error} cellCount={7} cells={loading ? [] : ownerCells(data)} />
      </header>

      <div className="sheet">
        {error && <p className="form-error" role="alert">{error}</p>}
        <PageTabs
          idPrefix="overview"
          label="Overview"
          current={tab}
          onChange={setTab}
          tabs={[
            { id: 'now', label: 'Right now', icon: 'live', count: loading ? null : data.sessions.length },
            { id: 'look', label: 'Worth a look', icon: 'alert', count: loading ? null : worthChips(data)[0].count },
          ]}
        />
        <div id="overview-panel" role="tabpanel" aria-labelledby={tab ? `overview-tab-${tab}` : undefined} aria-busy={loading || undefined}>
          {loading ? (error ? null : <RowsSkeleton rows={6} />) : tab === 'now' ? (
            data.sessions.length === 0
              ? <p className="empty">Nothing live right now.</p>
              : data.sessions.map((s) => <SessionCard key={s.id} session={s} showFacility={showFacility} now={now} />)
          ) : (
            <WorthALook
              warnings={data.warnings}
              leftOpen={data.leftOpen}
              duplicates={data.duplicates}
              showFacility={showFacility}
              now={now}
              actions={warningActions}
              duplicateActions={duplicateActions}
            />
          )}
        </div>
      </div>

      {dialogs}
    </section>
  )
}
