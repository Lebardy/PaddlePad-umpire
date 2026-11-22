/**
 * Where the other camera's video picks up when the player switches: the picked
 * point's second there, else the start of the highlight the reel is on, else
 * `second: null` (start where that video starts). `reelIndex` carries on only
 * when that video has the highlight.
 */
export function carryPlace({ to, selected, reelIndex }) {
  const second = selected === null || selected === undefined ? null : to.seconds?.[selected] ?? null
  const clip = reelIndex === null || reelIndex === undefined ? null : to.highlights?.[reelIndex] ?? null
  return { second: second ?? clip?.start ?? null, reelIndex: clip ? reelIndex : null }
}
