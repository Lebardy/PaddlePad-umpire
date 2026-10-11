// ============================================================
// One Camera screen's working parts: the camera, the recorder, the
// 2-second beat to the server, and the queue of videos still to send.
//
// Kept out of React on purpose. A recording must not restart because a
// component re-rendered, and a send must carry on while the screen
// shows something else. The screen makes one of these, listens to it,
// and closes it when it goes away.
//
// What it reports through onChange(state):
//   phase     'opening' | 'unsupported' | 'denied' | 'waiting' | 'filming'
//   stream    the camera, for the preview
//   cameras   back cameras to choose from: [{ id, label }]
//   cameraId  the one in use
//   picture   { width, height } as it is being shown
//   wide      the picture is wider than tall; nothing is filmed until it is
//   match     { id, teamA: [names], teamB: [names] } while filming
//   startedAt when filming began, by this phone's clock
//   sending   null, or { percent, failed, waiting } for the video going out
//   offline   the last beat did not get through
// ============================================================

import * as api from './api'
import { flattenMp4 } from './flattenMp4'
import { sendToBucket } from './videoUpload'
import { beatAction, firstFrameAt, isWide, noteBeatTiming, pickBitrate, pickType } from './videoClock'

const BEAT_MS = 2_000
const RETRY_MS = 15_000
const REFUSED_RETRY_MS = 5 * 60_000
const CAMERA_KEY = 'paddlepad.camera'
const MAX_VIDEO_BYTES = 2 * 1024 ** 3
// Stop filming a little short of the limit, so what was filmed can still be sent.
const FULL_BYTES = MAX_VIDEO_BYTES - 100 * 1024 ** 2

const remembered = () => { try { return localStorage.getItem(CAMERA_KEY) } catch { return null } }
const remember = (id) => { try { if (id) localStorage.setItem(CAMERA_KEY, id); else localStorage.removeItem(CAMERA_KEY) } catch { /* private mode */ } }
const recordType = () => pickType((type) => MediaRecorder.isTypeSupported(type))

// Whether this browser can film at all; the Tools entry and open() both ask.
export const canFilm = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && recordType())

export function createCameraSession({ deviceId, onChange }) {
  let state = {
    phase: 'opening', stream: null, cameras: [], cameraId: null, picture: { width: 0, height: 0 }, wide: false,
    match: null, startedAt: null, sending: null, offline: false,
  }
  let stream = null
  let recorder = null
  let filming = null        // { matchId, startedAt, width, height } for the match being filmed
  let timing = null         // the server's clock, from the beats
  let beatTimer = null
  let retryTimer = null
  let wakeLock = null
  let beating = false
  let sendingNow = false
  let closed = false
  const filmed = new Set()  // matches whose recording was queued, so none is filmed twice
  // shortcut: unsent videos wait here with no cap, upgrade if a court's wifi is ever down for whole evenings
  const queue = []          // videos waiting to go: { matchId, blob, meta }

  function set(changes) {
    state = { ...state, ...changes }
    if (!closed) onChange(state)
  }

  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen')
      if (closed) wakeLock?.release?.().catch(() => {})
    } catch { /* the phone's own setting decides then */ }
  }
  // The lock is dropped whenever the page is hidden; take it again on return.
  const onVisible = () => { if (document.visibilityState === 'visible' && !closed) keepAwake() }

  async function open(cameraId = remembered()) {
    if (!canFilm()) return set({ phase: 'unsupported' })
    const previous = stream
    const video = {
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
      ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } }),
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch (error) {
      // The remembered camera is gone (another phone's id, or a camera unplugged): start over without it.
      if (cameraId) { remember(null); return open(null) }
      return set({ phase: error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'denied' : 'unsupported' })
    }
    previous?.getTracks().forEach((track) => track.stop())
    if (closed) { stream.getTracks().forEach((track) => track.stop()); return undefined }
    const settings = stream.getVideoTracks()[0].getSettings()
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')
    if (closed) { stream.getTracks().forEach((track) => track.stop()); return undefined }
    const back = all.filter((device) => !/front/i.test(device.label))
    set({
      phase: 'waiting', stream,
      cameras: (back.length ? back : all).map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` })),
      cameraId: settings.deviceId ?? null,
      picture: { width: settings.width ?? 0, height: settings.height ?? 0 },
      wide: isWide(settings.width ?? 0, settings.height ?? 0),
    })
    if (!beatTimer) { beatTimer = setInterval(beat, BEAT_MS); beat() }
    document.addEventListener('visibilitychange', onVisible)
    return keepAwake()
  }

  /** The preview knows the picture's real shape, turned with the phone; the camera's settings do not always. */
  function setPicture(width, height) {
    if (!width || !height) return
    set({ picture: { width, height }, wide: isWide(width, height) })
  }

  function chooseCamera(id) {
    if (filming) return
    remember(id)
    open(id)
  }

  async function beat() {
    // Upright, the camera is not armed, so it does not say it is ready.
    if (beating || closed || (!state.wide && !filming)) return
    beating = true
    const sentAt = Date.now()
    try {
      const answer = await api.cameraBeat({
        deviceId, state: filming ? 'filming' : state.sending ? 'sending' : 'ready', matchId: filming?.matchId,
      })
      timing = noteBeatTiming(timing, { sentAt, receivedAt: Date.now(), serverNow: answer.now })
      const action = beatAction(filming?.matchId ?? null, answer.match?.id ?? null, filmed.has(answer.match?.id))
      if (action === 'start' && state.wide) await startFilming(answer.match)
      if (action === 'stop') stopFilming()
      if (state.offline) set({ offline: false })
    } catch {
      // Any failed beat is a dropped one (a restarting server answers 404 too); filming carries on and the next beat tries again.
      set({ offline: true })
    } finally {
      beating = false
    }
  }

  async function startFilming(match) {
    // Another phone may have it already, or the match may be gone; the next beat will say.
    try { await api.claimMatchVideo(match.id, deviceId) } catch { return }
    if (closed) return
    const parts = []
    let bytes = 0
    const mine = { matchId: match.id, startedAt: null, width: state.picture.width, height: state.picture.height }
    const made = new MediaRecorder(stream, {
      mimeType: recordType(), videoBitsPerSecond: pickBitrate(mine.width, mine.height), audioBitsPerSecond: 96_000,
    })
    made.ondataavailable = (event) => {
      if (!event.data?.size) return
      parts.push(event.data)
      bytes += event.data.size
      if (bytes > FULL_BYTES) stopFilming()
    }
    made.onstart = () => { mine.startedAt = Date.now(); set({ startedAt: mine.startedAt }) }
    made.onstop = () => finish(mine, parts)
    filming = mine
    recorder = made
    made.start(4_000)
    set({ phase: 'filming', match, startedAt: null })
  }

  function stopFilming() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  async function finish(mine, parts) {
    const stoppedAt = Date.now()
    filming = null
    recorder = null
    set({ phase: 'waiting', match: null, startedAt: null })
    if (!mine.startedAt || parts.length === 0) return
    let blob = new Blob(parts, { type: 'video/mp4' })
    let durationMs = stoppedAt - mine.startedAt
    let repacked = true
    try {
      const made = await flattenMp4(blob)
      blob = made.blob
      durationMs = Math.round(made.info.seconds * 1000)
    } catch {
      // Not sure of the tables, so nothing is rewritten: it goes as filmed and is marked so.
      repacked = false
    }
    filmed.add(mine.matchId)
    queue.push({
      matchId: mine.matchId, blob,
      meta: {
        deviceId, bytes: blob.size, width: mine.width, height: mine.height, durationMs: Math.max(1, durationMs),
        firstFrameAt: firstFrameAt(mine.startedAt, timing), repacked,
      },
    })
    pump()
  }

  /** Sends the videos in the queue, one at a time, oldest first. */
  async function pump() {
    clearTimeout(retryTimer)
    if (sendingNow || closed) return
    const next = queue[0]
    if (!next) { set({ sending: null }); return }
    sendingNow = true
    const report = (percent, failed) => set({ sending: { percent, failed, waiting: queue.length - 1 } })
    report(0, false)
    try {
      if (next.meta.bytes > MAX_VIDEO_BYTES) throw Object.assign(new Error('too big'), { final: true })
      const form = await api.startVideoUpload(next.matchId, next.meta).catch((error) => {
        // The match was cancelled, another phone holds it, or the numbers were refused: trying again changes nothing.
        if ([400, 404, 409, 413].includes(error.status)) error.final = true
        throw error
      })
      await sendToBucket(form, next.blob, (part) => report(Math.floor(part * 100), false))
      await api.finishVideoUpload(next.matchId, deviceId)
      queue.shift()
      sendingNow = false
      pump()
    } catch (error) {
      sendingNow = false
      if (error.final) { queue.shift(); pump(); return }
      report(state.sending?.percent ?? 0, true)
      retryTimer = setTimeout(pump, error.refused ? REFUSED_RETRY_MS : RETRY_MS)
    }
  }

  /** True while leaving the screen would lose something. */
  function isBusy() {
    return Boolean(filming) || queue.length > 0
  }

  function close() {
    closed = true
    clearInterval(beatTimer)
    clearTimeout(retryTimer)
    document.removeEventListener('visibilitychange', onVisible)
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop() }
    stream?.getTracks().forEach((track) => track.stop())
    wakeLock?.release?.().catch(() => {})
  }

  return { open, close, setPicture, chooseCamera, retryNow: pump, isBusy }
}
