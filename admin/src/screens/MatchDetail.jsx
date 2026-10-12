import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import { fetchMatch, removeMatchVideo } from '../lib/api'
import { formatWhen } from '../lib/format'
import { playingIndex, pointLine } from '../lib/matches'
import { Link } from '../lib/router'

const namesOf = (team) => team.map((player) => player.name).join(' & ')
// One name to a line under a score, so a long doubles pair never pushes the two scores apart.
const nameLines = (team) => team.map((player) => <span key={player.id}>{player.name}</span>)

/** The lamp and word for a match that is not an ordinary finished one, or null. */
function oddStatus(match) {
  if (match.voided) return { lamp: 'closed', word: 'Voided' }
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
  // play is pressed, the match is asked for once more, for a fresh one.
  const [asked, setAsked] = useState({ id, times: 0 })
  const times = asked.id === id ? asked.times : 0

  useEffect(() => {
    let live = true
    fetchMatch(id)
      .then((match) => { if (live) setResult({ id, match }) })
      .catch((err) => {
        // A second ask that fails leaves the page as it stands.
        if (!live || times > 0) return
        if (err.status === 404) setResult({ id, notFound: true })
        else setResult({ id, error: err.message })
      })
    return () => { live = false }
  }, [id, times])

  const loading = !result || result.id !== id
  const match = loading ? null : result.match

  async function handleRemoveVideo() {
    await removeMatchVideo(id)
    setResult({ id, match: await fetchMatch(id) })
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
        intro={status && <span className={`status-tag status-${status.lamp}`}>{status.word}</span>}
      >
        <div className="tally match-tally">
          <TallyCell figure={match.scoreA} label={nameLines(match.teamA)} variant="score" />
          <TallyCell figure={match.scoreB} label={nameLines(match.teamB)} variant="score" />
          <TallyCell figure={formatWhen(match.endedAt ?? match.startedAt)} label={<><Icon name="calendar" size={14} />When</>} variant="text" />
          <TallyCell figure={match.facilityName ?? '—'} label={<><Icon name="pin" size={14} />Where</>} variant="text" />
          <TallyCell figure={match.umpireName ?? '—'} label={<><Icon name="clipboard" size={14} />Umpire</>} variant="text" />
        </div>
      </PageBoard>

      <div className="sheet">
        <Link to="/" className="back-link">← Overview</Link>
        <PointByPoint
          match={match}
          onVideoError={() => { if (times < 1) setAsked({ id, times: times + 1 }) }}
          onRemoveVideo={handleRemoveVideo}
        />
      </div>
    </section>
  )
}

/**
 * The match's video, when it has one, and every point under it.
 *
 * With a video the two follow each other: tapping a point jumps the
 * video to that point's rally and plays, and as the video plays the
 * point on screen is the one lit. A point the video does not show still
 * says how it was won; it just is not a button. Nothing is asked of the
 * video's storage until play is pressed.
 *
 * Mounted afresh for each match (the page reads "Loading…" in between),
 * so the point lit never carries over from another match.
 */
function PointByPoint({ match, onVideoError, onRemoveVideo }) {
  const { points, video } = match
  const player = useRef(null)
  const [playing, setPlaying] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const names = { A: namesOf(match.teamA), B: namesOf(match.teamB) }

  function jump(index) {
    setPlaying(index)
    player.current.currentTime = video.seconds[index]
    player.current.play().catch(() => {})
    // A long match's last points sit a screen or two below the video.
    player.current.scrollIntoView({ block: 'nearest' })
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
          {match.mayRemoveVideo && (
            <div className="row-actions">
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
            </div>
          )}
        </div>
      )}

      <div>
        <div className="section-head">
          <h2 className="section-title"><Icon name="list" />Point by point</h2>
          {video && <span className="section-count"><Icon name="camera" size={16} />Tap a point to watch it</span>}
        </div>
        {points.length === 0 ? (
          <p className="empty">No points yet.</p>
        ) : (
          <>
            {/* The key to the bars: the first side's points are barred on the left, the other side's on the right. */}
            <p className="match-sides">
              <span className="match-side is-a">{names.A}</span>
              <span className="match-side is-b">{names.B}</span>
            </p>
            <ol className="match-points" style={{ '--point-rows': Math.ceil(points.length / 2) }}>
              {points.map((point, index) => {
                // The bar is seen, not heard: a screen reader is told the side by name.
                const line = <span><span className="sr-only">{names[point.team]}: </span>{pointLine(point)}</span>
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
