// ============================================================
// Small decisions the Camera screen makes, kept apart from the camera
// itself so they can be checked without one.
// ============================================================

/** The recorder says it has started about this long after its first picture (measured on the trial phone, steady). */
export const START_LATE_MS = 250

/**
 * The server's clock, learned from the beats. Each answer carries the
 * server's time; the answer that came back fastest is the one least
 * blurred by the network, so that one is kept.
 * `timing` is `{ offsetMs, roundTripMs }` or null; returns the new one.
 */
export function noteBeatTiming(timing, { sentAt, receivedAt, serverNow }) {
  const roundTripMs = receivedAt - sentAt
  if (!Number.isFinite(serverNow) || roundTripMs < 0) return timing
  if (timing && timing.roundTripMs <= roundTripMs) return timing
  return { offsetMs: Math.round(serverNow - (sentAt + receivedAt) / 2), roundTripMs }
}

/** When the first picture was taken, in the server's time. */
export function firstFrameAt(recorderStartedAt, timing) {
  return Math.round(recorderStartedAt - START_LATE_MS + (timing?.offsetMs ?? 0))
}

/**
 * What a beat's answer means for a camera that is, or is not, filming.
 * `filmingId` is the match being filmed (or null); `beatMatchId` is the
 * match the server named (or null).
 */
export function beatAction(filmingId, beatMatchId) {
  if (!filmingId) return beatMatchId ? 'start' : 'stay'
  return beatMatchId === filmingId ? 'stay' : 'stop'
}

/** 5 Mbit/s for a 1080p picture, 2.5 for anything smaller. */
export function pickBitrate(width, height) {
  return Math.max(width, height) >= 1920 ? 5_000_000 : 2_500_000
}

const MP4_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4']

/** The first MP4 type this browser can record, or null when it can record none. */
export function pickType(isSupported) {
  return MP4_TYPES.find((type) => isSupported(type)) ?? null
}

/** A court needs the wide picture. */
export function isWide(width, height) {
  return width > height
}

/** 04:12, or 1:04:12 past the hour. */
export function clockText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const two = (n) => String(n).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  return hours > 0 ? `${hours}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}` : `${two(Math.floor(total / 60))}:${two(total % 60)}`
}
