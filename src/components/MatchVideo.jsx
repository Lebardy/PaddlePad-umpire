import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { fetchMatchVideo, lineUpMatchVideo, removeMatchVideo } from '../lib/api'
import { clockText } from '../lib/videoClock'

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
  const [video, setVideo] = useState(null)
  const [fixing, setFixing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [at, setAt] = useState(0)
  const player = useRef(null)

  // Asked again every 10 seconds while a video is on its way, so it
  // appears by itself once the phone has finished sending.
  useEffect(() => {
    let live = true
    let timer = null
    const ask = () => fetchMatchVideo(matchId)
      .then((found) => {
        if (!live) return
        setVideo(found)
        if (found && found.state !== 'ready') timer = setTimeout(ask, 10_000)
      })
      .catch((error) => {
        // No video service reads as no video; any other failure (a wifi blip) is asked again.
        if (live && error.status !== 404) timer = setTimeout(ask, 10_000)
      })
    ask()
    return () => { live = false; clearTimeout(timer) }
  }, [matchId])

  if (!video) return null
  if (video.state !== 'ready') {
    return <p className="video-coming"><Icon name="camera" size={18} />The video is on its way.</p>
  }

  const byId = new Map(events.map((event) => [event.id, event]))
  const rallies = video.rallies.filter((rally) => byId.has(rally.id))
  // The rally being watched: the last one whose start has gone by.
  const playing = rallies.reduce((found, rally) => (rally.second !== null && rally.second <= at + 0.25 ? rally.id : found), null)

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
      setVideo(await lineUpMatchVideo(matchId, rallyId, player.current.currentTime))
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
      await removeMatchVideo(matchId)
      setVideo(null)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <section className="match-video">
      <h3><Icon name="camera" size={18} />Video</h3>
      <video
        ref={player}
        className="match-video-player"
        src={video.url}
        controls
        playsInline
        preload="metadata"
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
              <button className="video-rally" onClick={() => jump(rally.second)} disabled={rally.second === null}>
                <span className="video-rally-words">{describe(byId.get(rally.id))}</span>
                {rally.second !== null && <span className="video-rally-at">{clockText(rally.second * 1000)}</span>}
                {rally.second !== null && <Icon name={rally.id === playing ? 'pause' : 'play'} size={16} />}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default MatchVideo
