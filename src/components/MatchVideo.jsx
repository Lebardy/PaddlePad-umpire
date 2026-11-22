import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { fetchMatchVideo, lineUpMatchVideo, removeMatchVideo, setMatchHighlights } from '../lib/api'
import { clockText } from '../lib/videoClock'
import { keepLinks } from '../lib/keepLinks'

/**
 * A finished match's video: watch it, jump to any rally, fix its
 * timing, remove it. Shows nothing at all when the match has none.
 *
 * `events` is the match's own log; `describe(event)` gives a rally the
 * same words the History list uses. The server says where each rally
 * is in the video; this only moves the player there.
 *
 * Fix timing is the umpire's correction for a video whose rallies land
 * early or late: pause where any rally ends, tap that rally, and every
 * other rally follows from the tablet's own gaps between them.
 */
function MatchVideo({ matchId, events, describe }) {
  const [answer, setAnswer] = useState(null)
  const [angle, setAngle] = useState(0)
  const [fixing, setFixing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [at, setAt] = useState(0)
  const player = useRef(null)
  const resume = useRef(null)
  const chose = useRef(false)
  const [tick, setTick] = useState(0)

  // Asked again every 10 seconds while either video is on its way, so it
  // appears by itself once the phone has finished sending. A remove or a
  // line-up bumps `tick`, which asks afresh and starts the waiting again.
  useEffect(() => {
    let live = true
    let timer = null
    const ask = () => fetchMatchVideo(matchId)
      .then((found) => {
        if (!live) return
        setAnswer((was) => keepLinks(was, found))
        // Until the umpire picks an angle, stay on one that is ready.
        if (!chose.current && found?.video?.state !== 'ready' && found?.otherVideo?.state === 'ready') setAngle(1)
        setError(null)
        if (found?.video && [found.video, found.otherVideo].some((v) => v && v.state !== 'ready')) timer = setTimeout(ask, 10_000)
      })
      .catch((error) => {
        // No video service reads as no video; any other failure (a wifi blip) is shown and asked again.
        if (!live) return
        if (error.status === 404) return setAnswer(null)
        setError(error.message)
        timer = setTimeout(ask, 10_000)
      })
    ask()
    return () => { live = false; clearTimeout(timer) }
  }, [matchId, tick])

  if (!answer?.video) return null
  const video = angle === 1 && answer.otherVideo ? answer.otherVideo : answer.video
  const side = video.side ?? 'facility'
  const picked = new Set(answer.starred)
  const full = picked.size >= 5
  const angles = [answer.video, answer.otherVideo].filter(Boolean)
  const title = (
    <h3>
      <Icon name="camera" size={18} />Video
      <span className="video-star-count" aria-label={`${picked.size} of 5 highlights`}><Icon name="star" size={14} />{picked.size}/5</span>
    </h3>
  )
  const switcher = answer.otherVideo && (
    <div className="video-angles" role="group" aria-label="Camera">
      {angles.map((v, i) => (
        <button key={i} aria-pressed={v === video} onClick={() => choose(i)}>
          <Icon name="camera" size={18} /><span>{v.sideNames.length ? v.sideNames.join(' \u00b7 ') : `Camera ${i + 1}`}</span>
        </button>
      ))}
    </div>
  )
  const coming = <p className="video-coming"><Icon name="camera" size={18} />The video is on its way.</p>

  if (video.state !== 'ready') {
    if (!answer.otherVideo) return coming
    return <section className="match-video">{title}{switcher}{coming}</section>
  }

  const byId = new Map(events.map((event) => [event.id, event]))
  const rallies = video.rallies.filter((rally) => byId.has(rally.id))
  // The rally being watched: the last one whose start has gone by.
  const playing = rallies.reduce((found, rally) => (rally.second !== null && rally.second <= at + 0.25 ? rally.id : found), null)

  // Switching camera keeps the place: the rally being watched, and whether it was playing.
  function choose(next) {
    if (next === angle) return
    chose.current = true
    const target = next === 1 ? answer.otherVideo : answer.video
    resume.current = video.state === 'ready' && target.state === 'ready' ? { id: playing, going: player.current ? !player.current.paused : false } : null
    setFixing(false)
    setAngle(next)
  }

  function placed(event) {
    setAt(event.currentTarget.currentTime)
    const was = resume.current
    resume.current = null
    if (!was) return
    const second = video.rallies.find((rally) => rally.id === was.id)?.second
    if (second != null) event.currentTarget.currentTime = second
    if (was.going) event.currentTarget.play().catch(() => {})
  }

  // Starring saves at once; the star changes first and goes back if the save fails.
  async function star(rallyId) {
    if (saving) return
    const next = picked.has(rallyId) ? [...picked].filter((id) => id !== rallyId) : [...picked, rallyId]
    const before = answer
    setAnswer({ ...answer, starred: next })
    setSaving(true)
    setError(null)
    try {
      const saved = await setMatchHighlights(matchId, next)
      // Keep each video's link: a fresh one would reload the video and lose the umpire's place.
      setAnswer((was) => keepLinks(was, saved))
      setTick((t) => t + 1)
    } catch (err) {
      setAnswer((was) => ({ ...was, starred: before.starred }))
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function jump(second) {
    const element = player.current
    if (!element || second === null) return
    element.currentTime = second
    element.play().catch(() => {})
  }

  async function lineUp(rallyId) {
    setBusy(true)
    setError(null)
    try {
      setAnswer(await lineUpMatchVideo(matchId, rallyId, player.current.currentTime, side))
      setTick((t) => t + 1)
      setFixing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Remove this video? It cannot be brought back.')) return
    setBusy(true)
    setError(null)
    try {
      await removeMatchVideo(matchId, side)
      // The other angle, if any, becomes the video; the stars stay on the match.
      setAngle(0)
      setTick((t) => t + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="match-video">
      {title}
      {switcher}
      <video
        ref={player}
        className="match-video-player"
        src={video.url}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={placed}
        onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
      />

      {fixing ? (
        <div className="video-fix">
          <ol>
            <li>Pause where a rally <strong>ends</strong>.</li>
            <li>Tap that rally below.</li>
          </ol>
          <button onClick={() => setFixing(false)} disabled={busy}>Cancel</button>
        </div>
      ) : (
        <div className="video-actions">
          <button onClick={() => { player.current?.pause(); setFixing(true) }} disabled={busy}><Icon name="timer" size={18} />Fix timing</button>
          <button className="video-remove" onClick={remove} disabled={busy}><Icon name="trash" size={18} />Remove video</button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      <ul className="video-rallies">
        {[...rallies].reverse().map((rally) => (
          <li key={rally.id} className={rally.id === playing ? 'is-playing' : ''}>
            {fixing ? (
              <>
                <span className="video-rally-words">{describe(byId.get(rally.id))}</span>
                <button className="video-this" onClick={() => lineUp(rally.id)} disabled={busy || at === 0}>This one</button>
              </>
            ) : (
              <>
                <button className="video-rally" onClick={() => jump(rally.second)} disabled={rally.second === null}>
                  <span className="video-rally-words">{describe(byId.get(rally.id))}</span>
                  {rally.second !== null && <span className="video-rally-at">{clockText(rally.second * 1000)}</span>}
                  {rally.second !== null && <Icon name={rally.id === playing ? 'pause' : 'play'} size={16} />}
                </button>
                {rally.second !== null && (
                  <button
                    className={`video-star${picked.has(rally.id) ? ' is-on' : ''}`}
                    onClick={() => star(rally.id)}
                    disabled={full && !picked.has(rally.id)}
                    aria-disabled={saving}
                    aria-pressed={picked.has(rally.id)}
                    aria-label={picked.has(rally.id) ? 'Remove highlight' : 'Highlight'}
                  >
                    <Icon name="star" size={20} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default MatchVideo
