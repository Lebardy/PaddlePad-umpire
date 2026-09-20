import { useCallback, useEffect, useState } from 'react'
import DuplicatePlayers from '../components/DuplicatePlayers'
import FacilityPicker from '../components/FacilityPicker'
import LiveBoard from '../components/LiveBoard'
import SessionCard from '../components/SessionCard'
import Totals from '../components/Totals'
import WorthALook from '../components/WorthALook'
import { fetchOverview } from '../lib/api'
import { clockText } from '../lib/format'

const REFRESH_MS = 30_000

/** The landing page: what's going on right now, the totals, and anything worth a look. */
export default function Overview({ me, facilityLabel }) {
  const isOwner = me.role === 'owner'
  const [facilityId, setFacilityId] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => {
    return fetchOverview({ facilityId: isOwner ? facilityId : undefined })
      .then((next) => { setData(next); setNow(Date.now()); setError(null) })
      .catch((err) => setError(err.message))
  }, [isOwner, facilityId])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

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
            <WorthALook warnings={data.warnings} leftOpen={data.leftOpen} isOwner={showFacility} now={now} actions={null} />
            {data.duplicates && <DuplicatePlayers pairs={data.duplicates} now={now} actions={null} />}
          </>
        )}
      </div>
    </section>
  )
}
