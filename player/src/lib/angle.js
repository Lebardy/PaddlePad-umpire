/**
 * Where the other camera's video picks up when the player switches: the picked
 * point's second there, else the start of the highlight the reel is on, else
 * `second: null` (start where that video starts). The reel is matched by rally,
 * as each video holds only the stars it covers: the same rally there, else the
 * next starred rally that video has, else no reel.
 */
export function carryPlace({ from, to, selected, reelIndex }) {
  const second = selected === null || selected === undefined ? null : to.seconds?.[selected] ?? null
  const reel = reelIndex === null || reelIndex === undefined ? [] : from.highlights?.slice(reelIndex) ?? []
  let at = -1
  for (const { rally } of reel) {
    at = (to.highlights ?? []).findIndex((h) => h.rally === rally)
    if (at >= 0) break
  }
  const clip = at >= 0 ? to.highlights[at] : null
  return { second: second ?? clip?.start ?? null, reelIndex: clip ? at : null }
}
