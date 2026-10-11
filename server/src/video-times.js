// ============================================================
// Where each rally is in a match's video.
//
// Nothing here looks at the picture. The tablet stamps every rally
// with its own clock at the moment the umpire logs it -- the rally's
// END -- and the phone says when its first picture was taken, in this
// server's time. Line the two up and every rally has a second.
// ============================================================

/** A jump never lands more than this long before the rally's own end. */
export const MAX_LEAD_MS = 40_000

const MAX_OFFSET_MS = 24 * 60 * 60 * 1000

/**
 * How far a device's clock is from this server's: add it to a time the
 * device stamped to get the server's time. `sentAtMs` is the device's
 * clock as it sent the request. Null when the device sent none, or one
 * more than a day out, which is a broken clock and not an offset.
 */
export function clockOffsetMs(serverNowMs, sentAtMs) {
  if (!Number.isFinite(sentAtMs)) return null
  const offset = Math.round(serverNowMs - sentAtMs)
  return Math.abs(offset) <= MAX_OFFSET_MS ? offset : null
}

/**
 * The video second each rally starts at, or null for a rally the video
 * does not show (it ended before filming began, or began after the
 * video ended). `rallies` are in play order, each `{ atMs }` as the
 * tablet stamped it. A rally starts where the one before it ended (the
 * match's start for the first), capped at MAX_LEAD_MS before its own
 * end; one that began before the first picture plays from 0.
 */
export function rallySeconds({ startedAtMs, offsetMs, firstFrameAtMs, durationMs, rallies }) {
  const shift = (offsetMs ?? 0) - firstFrameAtMs
  return rallies.map((rally, index) => {
    const end = rally.atMs + shift
    const before = (index === 0 ? startedAtMs : rallies[index - 1].atMs) + shift
    const start = Math.max(before, end - MAX_LEAD_MS)
    if (end < 0 || start > durationMs) return null
    return Math.round(Math.max(0, start) / 100) / 10
  })
}

/**
 * Fix timing: the umpire paused the video at `videoSecond` and tapped
 * the rally that ended there. The first picture's moment that makes
 * that true, in the server's time, in milliseconds.
 */
export function firstFrameFromLineUp({ rallyAtMs, offsetMs, videoSecond }) {
  return Math.round(rallyAtMs + (offsetMs ?? 0) - videoSecond * 1000)
}
