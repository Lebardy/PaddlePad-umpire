import { useRef, useState } from 'react'
import { reelStep } from './reel'

/**
 * A match video beside its point boxes: tap a box to watch that point,
 * the picked box follows what is playing, and the Highlights reel plays
 * the umpire's picks back to back. Shared by a player's match page and
 * the match of the month so the two cannot drift apart.
 */
export function usePointVideo(video, count, selected, onSelect) {
  const ref = useRef(null)
  const [reel, setReel] = useState(null) // { video, index }
  // Our own jumps, so only the viewer's own seeking leaves the reel.
  const jumping = useRef(false)
  const clips = video?.highlights ?? []
  // A reel belongs to the video it was started on: another match, or a fresh link, ends it.
  const clip = reel?.video === video ? reel.index : null

  function seek(second) {
    const node = ref.current
    if (!node) return
    // The browser says "seeking" for every jump once the video has loaded, even one to
    // where it already is; before that, only for a jump past the start.
    jumping.current = node.readyState > 0 || second > 0
    node.currentTime = second
    node.play().catch(() => {})
  }

  function pick(index) {
    setReel(null)
    onSelect(index)
    const second = video?.seconds?.[index]
    if (!ref.current) return
    if (second === null || second === undefined) return ref.current.pause()
    seek(second)
  }

  function playReel() {
    if (clips.length === 0) return
    setReel({ video, index: 0 })
    seek(clips[0].start)
  }

  function onTimeUpdate(event) {
    const node = event.currentTarget
    if (node.paused) return
    const at = node.currentTime
    if (clip !== null) {
      const step = reelStep(clips, clip, at)
      if (step.done) { node.pause(); setReel(null) }
      else if (step.index !== clip) { setReel({ video, index: step.index }); seek(step.seek) }
    }
    // The point being played: the last one whose rally has started.
    let playing = null
    video.seconds.forEach((second, index) => {
      if (second !== null && second <= at + 0.25 && index < count) playing = index
    })
    if (playing !== null && playing !== selected) onSelect(playing)
  }

  function onSeeking() {
    if (jumping.current) { jumping.current = false; return }
    setReel(null)
  }

  return {
    ref, pick, playReel, onTimeUpdate, onSeeking,
    reel: clip !== null ? { at: clip + 1, of: clips.length } : null,
    starred: new Set(clips.map((clip) => clip.point).filter((point) => point !== null)),
  }
}
