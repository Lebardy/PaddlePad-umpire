import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import FacilityPicker from '../components/FacilityPicker'
import Icon from '../components/Icon'
import PageBoard from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import StatusTag from '../components/StatusTag'
import { addOpenPlay, cancelOpenPlay, fetchGuests, listFacilities, setCourtUmpire } from '../lib/api'
import { countWord } from '../lib/format'
import {
  comingWords, courtCount, dayOptions, endHours, feeWords, scoreWords, spotsFor, startHours, toIso, whenWords,
} from '../lib/guests'

const FACES = [1, 2, 3, 4, 5]
const CHIP_LINES = [{ key: 'good', label: 'Made it good' }, { key: 'better', label: 'Could be better' }]

/** A place as a host: it posts open play, sees who's coming, and hears how visits went. */
export default function Guests({ me, facilityLabel }) {
  const isOwner = me.role === 'owner'
  const [facilities, setFacilities] = useState(null)
  const [picked, setPicked] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [newest, setNewest] = useState(null)
  const [openCourts, setOpenCourts] = useState(null)
  const playsHeading = useRef(null)

  // The owner starts on the first place by name; a manager is always on their own.
  useEffect(() => {
    if (!isOwner) return
    let live = true
    listFacilities()
      .then((rows) => {
        if (!live) return
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))
        setFacilities(sorted)
        setPicked((current) => current || sorted[0]?.id || '')
      })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [isOwner])

  const facilityId = isOwner ? picked : me.facilityId
  const facilityName = isOwner ? facilities?.find((f) => f.id === picked)?.name : facilityLabel

  const load = useCallback(() => fetchGuests(facilityId).then((next) => { setData(next); setError(null) }), [facilityId])

  useEffect(() => {
    if (!facilityId) return
    let live = true
    fetchGuests(facilityId)
      .then((next) => { if (live) { setData(next); setError(null) } })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [facilityId])

  function pick(id) {
    setData(null)
    setConfirming(null)
    setNewest(null)
    setOpenCourts(null)
    setPicked(id)
  }

  // Errors are thrown back to the row's confirmation, which shows them there.
  async function handleCancel(id) {
    await cancelOpenPlay(facilityId, id)
    await load()
    // The row is gone, so keyboard focus comes back to the section.
    playsHeading.current?.focus()
  }

  if (!isOwner && !me.facilityId) {
    return <section className="sheet"><p className="empty missing">You’re not linked to a facility yet. Ask the owner.</p></section>
  }

  return (
    <section>
      <PageBoard title="Open play" intro={facilityName ? <><strong>{facilityName}</strong>, the next 7 days.</> : null}>
        <FacilityPicker me={me} value={picked} onChange={pick} variant="board" />
      </PageBoard>

      <div className="sheet">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data && !error && <p className="empty">Loading…</p>}
        {data && (
          <>
            <GuestTotals totals={data.totals} visits={data.visits} />

            <div>
              <div className="section-head">
                <h2 className="section-title" tabIndex={-1} ref={playsHeading}>
                  <Icon name="calendar" />Coming up<span className="worth-count">{data.openPlays.length}</span>
                </h2>
              </div>
              <OpenPlayForm
                key={facilityId}
                onAdd={async (body) => {
                  const added = await addOpenPlay(facilityId, body)
                  setNewest(added.id)
                  await load()
                }}
              />
              {data.openPlays.length > 0 && (
                <div className="table-wrap guests-table">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Courts</th>
                        <th>Fee</th>
                        <th>Spots</th>
                        <th>Who’s coming</th>
                        <th>Status</th>
                        <th className="col-actions"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.openPlays.map((play) => {
                        const sub = play.note
                        return (
                          <Fragment key={play.id}>
                          <tr className={newest === play.id ? 'is-new' : undefined}>
                            <td>
                              <span className="cell-main"><b>{whenWords(play.startsAt, play.endsAt)}</b></span>
                              {sub && <span className="cell-sub">{sub}</span>}
                            </td>
                            <td>
                              {play.courtRoster ? (
                                <button
                                  type="button"
                                  className="court-count"
                                  aria-expanded={openCourts === play.id}
                                  aria-controls={`courts-${play.id}`}
                                  onClick={() => setOpenCourts(openCourts === play.id ? null : play.id)}
                                >
                                  <Icon name="court" />{courtCount(play.courtRoster)}
                                </button>
                              ) : (
                                <span className="cell-sub">No umpire</span>
                              )}
                            </td>
                            <td className="cell-figure">{feeWords(play.feeCentavos)}</td>
                            <td>
                              <span className="cell-figure">{play.count} / {play.spots}</span>
                              <span className="spots-meter" aria-hidden="true">
                                <i style={{ width: `${Math.min(100, (play.count / play.spots) * 100)}%` }} />
                              </span>
                            </td>
                            <td>{comingWords(play)}</td>
                            <td><StatusTag status={play.status} /></td>
                            <td className="col-actions">
                              <div className="row-actions">
                                <RowConfirm
                                  label="Cancel"
                                  className="btn-danger btn-small"
                                  question={`Cancel it? ${play.count === 1 ? '1 player is' : `${play.count} players are`} going.`}
                                  confirmLabel="Confirm"
                                  busyLabel="Cancelling…"
                                  confirmClass="btn-danger is-solid btn-small"
                                  keepLabel="Not now"
                                  open={confirming === play.id}
                                  onOpen={() => setConfirming(play.id)}
                                  onClose={() => setConfirming(null)}
                                  onConfirm={() => handleCancel(play.id)}
                                />
                              </div>
                            </td>
                          </tr>
                          {openCourts === play.id && play.courtRoster && (
                            <tr className="court-strip" id={`courts-${play.id}`}>
                              <td colSpan={7}>
                                <div className="court-grid">
                                  {play.courtRoster.map((slot) => (
                                    <CourtCard key={slot.court} facilityId={facilityId} play={play} slot={slot} umpires={data.umpires} onSaved={load} />
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Visits visits={data.visits} />
          </>
        )}
      </div>
    </section>
  )
}

/** One court: the manager picks who umpires it; the rest is read-only. */
function CourtCard({ facilityId, play, slot, umpires, onSaved }) {
  const [state, setState] = useState(null) // null | 'saving' | 'saved' | error text
  // The pick shows straight away; otherwise the select snaps back to the old umpire until the list reloads.
  const [picked, setPicked] = useState(null)
  const takenElsewhere = new Set(play.courtRoster.filter((c) => c.court !== slot.court && c.umpire).map((c) => c.umpire.id))
  async function change(event) {
    if (state === 'saving') return // aria-disabled keeps focus but does not block changes
    const value = event.target.value
    setPicked(value)
    setState('saving')
    try {
      await setCourtUmpire(facilityId, play.id, slot.court, value || null)
      await onSaved().catch(() => {}) // the save stood; a failed reload only leaves the old list showing
      setState('saved')
    } catch (err) {
      setState(err.message)
    }
    setPicked(null)
  }
  const id = `court-${play.id}-${slot.court}`
  return (
    <div className="court-card">
      <div className="court-card-head">
        <label htmlFor={id}><Icon name="court" />Court {slot.court}</label>
        {/* always in the page, so a screen reader hears the words when they appear */}
        <span className="court-saved" role="status">{state === 'saved' && <><Icon name="check" />Saved</>}</span>
      </div>
      <select id={id} value={picked ?? slot.umpire?.id ?? ''} onChange={change} aria-disabled={state === 'saving'}>
        <option value="">Anyone</option>
        {slot.umpire && slot.umpire.active === false && <option value={slot.umpire.id}>{slot.umpire.name} (can’t start)</option>}
        {umpires.map((u) => (
          <option key={u.id} value={u.id} disabled={takenElsewhere.has(u.id)}>
            {u.name}{takenElsewhere.has(u.id) ? ' · on another court' : ''}
          </option>
        ))}
      </select>
      <span className="court-state">
        {slot.session
          ? <>{!slot.session.ended && <i className="live-lamp" aria-hidden="true" />}{slot.session.ended ? 'Ended' : `Started by ${slot.session.startedBy}`}</>
          : 'Not started'}
      </span>
      {state && !['saving', 'saved'].includes(state) && <p className="form-error" role="alert">{state}</p>}
    </div>
  )
}

/** Coming, spots taken, the visit score, and the next open play, in one ruled row. */
function GuestTotals({ totals, visits }) {
  const score = scoreWords(visits)
  return (
    <div className="totals totals-row">
      <div className="total">
        <span className="total-label">Coming</span>
        <span className="total-figure">{totals.coming}</span>
        <span className="total-new">to {countWord(totals.openPlays, 'open play', 'open plays')}</span>
      </div>
      <div className="total">
        <span className="total-label">Spots taken</span>
        <span className="total-figure">{totals.taken}<small>/{totals.spots}</small></span>
        <span className="total-new">{totals.spots - totals.taken} left</span>
      </div>
      <div className="total">
        <span className="total-label">Visit score</span>
        <span className="total-figure">{score.figure ?? '—'}</span>
        <span className="total-new">{score.words}</span>
      </div>
      <div className="total-rating">
        <span className="total-label">Next open play</span>
        <strong>{totals.next ? whenWords(totals.next.startsAt, totals.next.endsAt) : '—'}</strong>
        {totals.next && <span className="sub">{totals.next.count} of {totals.next.spots} spots</span>}
      </div>
    </div>
  )
}

/** The form strip: an open play is added here, never in a pop-up. */
function OpenPlayForm({ onAdd }) {
  const [days, setDays] = useState(() => dayOptions(Date.now()))
  const [day, setDay] = useState(days[1].value)
  // Relabelled each minute, so a page left open past midnight never calls today "Tomorrow".
  useEffect(() => {
    const timer = setInterval(() => setDays(dayOptions(Date.now())), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [start, setStart] = useState(6)
  const [end, setEnd] = useState(9)
  const [courts, setCourts] = useState('1')
  const [spots, setSpots] = useState('8')
  // Spots follow the courts until someone types their own.
  const [spotsEdited, setSpotsEdited] = useState(false)
  const [fee, setFee] = useState('')
  const [umpire, setUmpire] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const umpireLabel = useId()

  function changeStart(value) {
    setStart(value)
    const ends = endHours(value)
    setEnd((current) => Math.min(Math.max(current, ends[0].value), ends.at(-1).value))
  }

  function changeCourts(value) {
    setCourts(value)
    if (!spotsEdited) setSpots(String(spotsFor(Number(value))))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onAdd({
        startsAt: toIso(day, start), endsAt: toIso(day, end),
        courts: Number(courts), spots: Number(spots), fee, umpire, note,
      })
      setNote('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form className="form-strip guests-form" onSubmit={submit}>
        <label className="field">
          <span>Day</span>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Starts</span>
          <select value={start} onChange={(e) => changeStart(Number(e.target.value))}>
            {startHours.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Ends</span>
          <select value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {endHours(start).map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </label>
        <label className="field field-number">
          <span>Courts</span>
          <input type="number" inputMode="numeric" value={courts} onChange={(e) => changeCourts(e.target.value)} />
        </label>
        <label className="field field-number">
          <span>Spots</span>
          <input type="number" inputMode="numeric" value={spots}
            onChange={(e) => { setSpotsEdited(true); setSpots(e.target.value) }} />
        </label>
        <label className="field field-number">
          <span>Fee (₱)</span>
          <input inputMode="decimal" placeholder="Free" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <div className="field" role="group" aria-labelledby={umpireLabel}>
          <span id={umpireLabel}>Umpire</span>
          <button type="button" className={umpire ? 'btn-primary' : 'btn-quiet'} aria-pressed={umpire} onClick={() => setUmpire(!umpire)}>
            {umpire ? <><Icon name="check" size={16} />On duty</> : 'Off'}
          </button>
        </div>
        <label className="field grow">
          <span>Note (optional)</span>
          <input maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}><Icon name="plus" size={16} />Add open play</button>
        <p className="hint guests-hint">1 to 8 hours, ending by 11 pm. Spots start at 8 per court. Leave the fee empty for free.</p>
      </form>
      {error && <p className="form-error guests-error" role="alert">{error}</p>}
    </>
  )
}

/** How visits went, the last 30 days, never by name: the score, the faces, and the chips. */
function Visits({ visits }) {
  const score = scoreWords(visits)
  return (
    <div>
      <div className="section-head">
        <h2 className="section-title"><Icon name="face5" />How visits went</h2>
      </div>
      <div className="visits">
        <div className="visits-score">
          {score.figure && <b>{score.figure}</b>}
          <span>{score.words}</span>
        </div>
        <div className="visits-detail">
          <ul className="visits-faces">
            {FACES.map((face) => (
              <li key={face}>
                <Icon name={`face${face}`} size={24} className="icon-solo" />
                <span className="sr-only">{face} out of 5:</span>
                <b>{visits.faces[face - 1]}</b>
              </li>
            ))}
          </ul>
          {CHIP_LINES.map((line) => {
            const chips = Object.entries(visits[line.key])
            return (
              <div className="visits-line" key={line.key}>
                <span className="total-label">{line.label}</span>
                {chips.length === 0 ? <span className="visits-none">—</span> : chips.map(([chip, n]) => (
                  <span className="visits-chip" key={chip}>{chip}<span className="tab-count">{n}</span></span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
