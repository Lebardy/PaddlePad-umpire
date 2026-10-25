import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { createCameraSession } from '../lib/cameraSession'
import { getDeviceId } from '../lib/outbox'
import { clockText } from '../lib/videoClock'

/**
 * The Camera screen, for the phone in the holder.
 *
 * It films each match this umpire scores, by itself: it asks the server
 * every 2 seconds whether a match is on, starts when one begins, stops
 * when it ends, then repacks the recording and sends it. Nothing here
 * is tapped during play. The working parts live in lib/cameraSession.js;
 * this only shows what they report.
 *
 * It never sends a match's log, so it can never take scoring away from
 * the tablet.
 */
function Camera({ onBack }) {
  const [state, setState] = useState({
    phase: 'opening', stream: null, cameras: [], cameraId: null, picture: { width: 0, height: 0 }, wide: false,
    match: null, startedAt: null, sending: null, offline: false,
  })
  const [now, setNow] = useState(() => Date.now())
  const session = useRef(null)
  const preview = useRef(null)

  useEffect(() => {
    const made = createCameraSession({ deviceId: getDeviceId(), onChange: setState })
    session.current = made
    made.open()
    return () => made.close()
  }, [])

  // The preview is the one place that knows the picture's real shape as the phone turns.
  useEffect(() => {
    const video = preview.current
    if (!video || !state.stream) return undefined
    if (video.srcObject !== state.stream) video.srcObject = state.stream
    const shape = () => session.current?.setPicture(video.videoWidth, video.videoHeight)
    video.addEventListener('loadedmetadata', shape)
    video.addEventListener('resize', shape)
    return () => {
      video.removeEventListener('loadedmetadata', shape)
      video.removeEventListener('resize', shape)
    }
  }, [state.stream])

  useEffect(() => {
    if (state.phase !== 'filming') return undefined
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [state.phase])

  function leave() {
    if (session.current?.isBusy() && !confirm('Leave? Filming stops here. What was filmed is sent when you open Camera again.')) return
    onBack()
  }

  if (state.phase === 'unsupported' || state.phase === 'denied') {
    return (
      <div className="camera-note">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h2>{state.phase === 'denied' ? 'The camera is not allowed' : "This browser can't film here"}</h2>
        <p>
          {state.phase === 'denied'
            ? 'Allow the camera and the microphone for PaddlePad in the browser’s settings, then open this screen again.'
            : 'Filming needs a recent Chrome browser.'}
        </p>
      </div>
    )
  }

  const filming = state.phase === 'filming'
  const upright = state.phase === 'waiting' && !state.wide && !state.sending
  const quality = Math.min(state.picture.width, state.picture.height) >= 1080 ? '1080P' : '720P'
  const names = state.match ? [state.match.teamA.join(' & '), state.match.teamB.join(' & ')] : []
  const score = state.match?.score

  return (
    <div className="camera">
      <video ref={preview} className="camera-picture" muted playsInline autoPlay aria-label="Camera picture" />

      {upright && (
        <div className="camera-upright">
          <button className="back-link" onClick={leave}>&larr; Back</button>
          <div className="camera-upright-body">
            <span className="camera-turn" aria-hidden="true"><Icon name="retry" size={72} /></span>
            <h2>Turn the phone sideways</h2>
            <p>The camera starts once the picture is wide.</p>
          </div>
          <p className="camera-hint"><Icon name="retry" size={18} />Still upright? Switch on <strong>auto-rotate</strong>.</p>
        </div>
      )}

      {!upright && (
        <div className="camera-over">
          <div className="camera-top">
            {filming ? (
              <span className="camera-chip"><Icon name="lock" size={18} />Stops when the match ends</span>
            ) : (
              <button className="camera-round" onClick={leave} aria-label="Back"><Icon name="chevron" size={22} className="camera-back-icon" /></button>
            )}
            <span className="camera-top-right">
              {state.offline && <span className="camera-tag camera-tag--warn"><Icon name="offline" size={16} />No connection</span>}
              {state.phase !== 'opening' && <span className="camera-tag">{quality}</span>}
              {!filming && state.cameras.length > 1 && (
                <label className="camera-choice">
                  <Icon name="camera" size={20} />
                  <span className="visually-hidden">Camera</span>
                  <select value={state.cameraId ?? ''} onChange={(event) => session.current?.chooseCamera(event.target.value)}>
                    {state.cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.label}</option>)}
                  </select>
                </label>
              )}
            </span>
          </div>

          <div className="camera-status" role="status">
            {filming && (
              <>
                <span className="camera-line">
                  <span className="camera-dot" aria-hidden="true" />
                  <strong>Filming</strong>
                  <span className="camera-clock" role="timer">{state.startedAt ? clockText(now - state.startedAt) : '00:00'}</span>
                </span>
                {score ? (
                  <span className="camera-score">
                    {['A', 'B'].map((side, row) => (
                      <span key={side} className="camera-score-row">
                        <span className={score.serving === side ? 'camera-serve is-serving' : 'camera-serve'} aria-hidden="true" />
                        <span className="camera-score-name">
                          {score.serving === side && <span className="visually-hidden">serving </span>}
                          {names[row]}
                        </span>
                        <span className="camera-points">{score[side.toLowerCase()]}</span>
                        <span className="camera-server">
                          {score.serving === side && score.server && (
                            <>
                              <span className="visually-hidden">server </span>{score.server}
                            </>
                          )}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="camera-names">{names[0]}<br />{names[1]}</span>
                )}
              </>
            )}
            {!filming && state.sending && (
              <span className="camera-sending">
                <span className="camera-line">
                  <Icon name="upload" size={26} />
                  <strong>{state.sending.failed ? 'Not sent yet' : 'Sending'}</strong>
                  <span className="camera-clock">{state.sending.percent}%</span>
                </span>
                <span className="camera-bar" role="img" aria-label={`${state.sending.percent} percent sent`}>
                  <span style={{ width: `${state.sending.percent}%` }} />
                </span>
                <span className="camera-keep">
                  <Icon name="alert" size={18} />Keep this screen open
                  {state.sending.failed && <button className="camera-again" onClick={() => session.current?.retryNow()}>Try now</button>}
                </span>
              </span>
            )}
            {!filming && !state.sending && (
              <span className="camera-line">
                <Icon name="timer" size={26} />
                <strong>{state.phase === 'opening' ? 'Opening the camera' : 'Waiting for a match'}</strong>
              </span>
            )}
          </div>
          {filming && state.sending && (
            <span className="camera-tag camera-also">Sending the last match {state.sending.percent}%</span>
          )}
        </div>
      )}
    </div>
  )
}

export default Camera
