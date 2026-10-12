import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import { fetchMatch, removeMatchVideo } from '../lib/api'
import { formatWhen } from '../lib/format'
import { playingIndex, pointLine, pointMark, pointSaid } from '../lib/matches'
import { Link } from '../lib/router'

const namesOf = (team) => team.map((player) => player.name).join(' & ')
// One name to a line under a score, so a long doubles pair never pushes the two scores apart.
const nameLines = (team) => team.map((player) => <span key={player.id}>{player.name}</span>)

/** The lamp and word for a match that is not an ordinary finished one, or null. */
function oddStatus(match) {
  if (match.voided) return { lamp: 'voided', word: 'Voided', icon: 'ban' }
  if (match.status === 'in_progress') return { lamp: 'active', word: 'In progress' }
  if (match.endedEarly) return { lamp: 'paused', word: 'Ended early' }
  return null
}

/** One match's page: the score, who played, when, where and the umpire, every point, and its video when it was filmed. */
export default function MatchDetail({ id }) {
  // One result per id, as on a player's page: comparing its id to the
  // current prop is what tells a still-loading id apart from one
  // already answered.
  const [result, setResult] = useState(null)
  // The video's link lasts two hours. If it has run out by the time
  // play is pressed, the match is asked for once more by itself, for a
  // fresh one. If the video still cannot be loaded the page says so and
  // waits for "Try again": it never keeps asking by itself.
  const [asked, setAsked] = useState({ id, times: 0, retried: false, failed: false })
  const { times, retried, failed } = asked.id === id ? asked : { times: 0, retried: false, failed: false }

  useEffect(() => {
    let live = true
    fetchMatch(id)
      .then((match) => { if (live) setResult({ id, match }) })
      .catch((err) => {
        if (!live) return
        // A later ask that fails leaves the page as it stands: only the video is said to have failed.
        if (times > 0) setAsked({ id, times, retried: true, failed: true })
        else if (err.status === 404) setResult({ id, notFound: true })
        else setResult({ id, error: err.message })
      })
    return () => { live = false }
  }, [id, times])

  const loading = !result || result.id !== id
  const match = loading ? null : result.match

  function handleVideoError() {
    setAsked(retried ? { id, times, retried, failed: true } : { id, times: times + 1, retried: true, failed: false })
  }

  async function handleRemoveVideo() {
    // A 404 says the video, or the whole match, is already gone: the page is behind, so it reads again and says no error.
    const removed = await removeMatchVideo(id).then(() => true, (err) => { if (err.status !== 404) throw err; return false })
    // Gone on the server whatever the next read says, so gone from the page at once.
    if (removed) setResult({ id, match: { ...match, video: null, mayRemoveVideo: false } })
    try {
      setResult({ id, match: await fetchMatch(id) })
    } catch (err) {
      if (removed) return
      if (err.status !== 404) throw err
      setResult({ id, notFound: true })
    }
  }

  if (loading) return <section className="sheet"><p className="empty">Loading…</p></section>

  if (result.notFound) {
    return (
      <section className="sheet">
        <p className="empty missing">There’s no match here.</p>
        <p><Link to="/" className="back-link">← Overview</Link></p>
      </section>
    )
  }

  if (result.error) {
    return (
      <section className="sheet">
        <p className="form-error" role="alert">{result.error}</p>
        <p><Link to="/" className="back-link">← Overview</Link></p>
      </section>
    )
  }

  const status = oddStatus(match)
  return (
    <section>
      <PageBoard
        title={<>{namesOf(match.teamA)} <span className="match-vs">vs</span> {namesOf(match.teamB)}</>}
        intro={status && (
          <>
            <span className={`status-tag status-${status.lamp}`}>{status.icon && <Icon name={status.icon} size={14} className="icon-solo" />}{status.word}</span>
            {match.voided?.reason && <span className="void-reason">{match.voided.reason}</span>}
          </>
        )}
      >
        <div className={`tally match-tally${match.voided ? ' is-voided' : ''}`}>
          <TallyCell figure={match.scoreA} label={nameLines(match.teamA)} variant="score" />
          <TallyCell figure={match.scoreB} label={nameLines(match.teamB)} variant="score" />
          <TallyCell figure={formatWhen(match.endedAt ?? match.startedAt)} label={<><Icon name="calendar" size={14} />When</>} variant="text" />
          <TallyCell figure={match.facilityName ?? '—'} label={<><Icon name="pin" size={14} />Where</>} variant="text" />
          <TallyCell figure={match.umpireName ?? '—'} label={<><Icon name="clipboard" size={14} />Umpire</>} variant="text" />
        </div>
      </PageBoard>

      <div className={match.video ? 'sheet match-filmed' : 'sheet'}>
        {/* A filmed match keeps the way back under its video, so the video starts as high as it can. */}
        {!match.video && <Link to="/" className="back-link">← Overview</Link>}
        <PointByPoint
          match={match}
          videoFailed={failed}
          onVideoError={handleVideoError}
          onTryAgain={() => setAsked({ id, times: times + 1, retried: false, failed: false })}
          onRemoveVideo={handleRemoveVideo}
        />
      </div>
    </section>
  )
}

/**
 * The match's video, when it has one, and every point beside it.
 *
 * With a video the two follow each other: tapping a point jumps the
 * video to that point's rally and plays, and as the video plays the
 * point on screen is the one lit. The video stays put while the points
 * scroll, so the two are always seen together. A point the video does
 * not show still says how it was won; it just is not a button. Nothing
 * is asked of the video's storage until play is pressed.
 *
 * Mounted afresh for each match (the page reads "Loading…" in between),
 * so the point lit never carries over from another match.
 */
function PointByPoint({ match, videoFailed, onVideoError, onTryAgain, onRemoveVideo }) {
  const { points, video } = match
  const player = useRef(null)
  const [playing, setPlaying] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const names = { A: namesOf(match.teamA), B: namesOf(match.teamB) }

  function jump(index) {
    setPlaying(index)
    player.current.currentTime = video.seconds[index]
    player.current.play().catch(() => {})
  }

  return (
    <>
      {video && (
        <div className="match-watch">
          <div className="match-stage">
            <video
              ref={player}
              className="match-video"
              src={video.url}
              controls
              playsInline
              preload="none"
              aria-label="Video of this match"
              onTimeUpdate={(event) => setPlaying(playingIndex(video.seconds, event.currentTarget.currentTime))}
              onError={onVideoError}
            />
          </div>
          {videoFailed && (
            <div className="actions-row">
              <p className="form-error" role="alert">Couldn’t load the video.</p>
              <button type="button" className="btn-quiet btn-small" onClick={onTryAgain}>Try again</button>
            </div>
          )}
          <div className="row-actions">
            <Link to="/" className="back-link">← Overview</Link>
            {match.mayRemoveVideo && (
              <RowConfirm
                label="Remove video"
                className="btn-danger btn-small"
                question="It cannot be brought back."
                confirmLabel="Remove"
                busyLabel="Removing…"
                confirmClass="btn-danger btn-small"
                open={confirming}
                onOpen={() => setConfirming(true)}
                onClose={() => setConfirming(false)}
                onConfirm={onRemoveVideo}
              />
            )}
          </div>
        </div>
      )}

      <div>
        <div className="section-head">
          <h2 className="section-title"><Icon name="list" />Point by point</h2>
          {video && <span className="section-count"><Icon name="camera" size={16} />Tap a point to watch it</span>}
        </div>
        {points.length === 0 ? (
          <p className="empty">{match.status === 'in_progress' ? 'No points yet.' : 'No points.'}</p>
        ) : (
          <>
            {/* The key to the bars: the first side's points are barred on the left, the other side's on the right. */}
            <p className="match-sides">
              <span className="match-side is-a">{names.A}</span>
              <span className="match-side is-b">{names.B}</span>
            </p>
            <ol className="match-points" style={{ '--point-rows': Math.ceil(points.length / 2) }}>
              {points.map((point, index) => {
                const mark = pointMark(point)
                // The bar and the mark are seen, not heard: a screen reader is told the side and how the point ended in words.
                const line = (
                  <span className="point-line">
                    <span className="sr-only">{pointSaid(point, names[point.team])}</span>
                    <Icon name={mark} size={22} className={`point-mark is-${mark}`} />
                    <span aria-hidden="true">{pointLine(point)}</span>
                  </span>
                )
                return (
                  <li key={index} className={`match-point is-${point.team.toLowerCase()}`}>
                    {video && video.seconds[index] != null ? (
                      <button type="button" aria-current={playing === index ? 'true' : undefined} onClick={() => jump(index)}>
                        {line}
                        <Icon name="camera" size={16} className="icon-solo" />
                      </button>
                    ) : line}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
    </>
  )
}
