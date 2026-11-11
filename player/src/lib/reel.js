/**
 * The Highlights reel, one time update at a time: playing clip `index`
 * at `second`, keep going, jump to the next clip, or stop after the last
 * (or after this one, when `only` this clip was asked for).
 */
export function reelStep(clips, index, second, only = false) {
  const clip = clips[index]
  if (!clip) return { done: true }
  if (second < clip.end) return { index }
  const next = index + 1
  if (only) return { done: true }
  return next < clips.length ? { index: next, seek: clips[next].start } : { done: true }
}
