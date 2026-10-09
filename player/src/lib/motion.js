// ============================================================
// Calm motion, and a way out of it.
//
// Three small helpers so the newest screens can settle into place once
// when they open -- a number counting up, a ribbon appearing as it is
// scrolled to -- without a dependency. The app carries nothing beyond
// React, and an animation library would be the heaviest thing in it.
//
// Every one of them does nothing for anyone whose phone asks for
// reduced motion: they get the finished screen at once. The CSS side of
// that promise is the prefers-reduced-motion block in App.css.
// ============================================================

import { useEffect, useState } from 'react'

const REDUCE = '(prefers-reduced-motion: reduce)'

/** Whether this person's device asks for less motion. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && (window.matchMedia?.(REDUCE).matches ?? false)
}

/**
 * True once the element has been scrolled into view, and stays true.
 *
 * So something below the fold animates when it is actually seen rather
 * than finishing off-screen while the top of the page is being read.
 * Starts true where there is nothing to wait for: no IntersectionObserver,
 * or a person who asked for no motion.
 */
export function useInView(ref, threshold = 0.25) {
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion(),
  )

  useEffect(() => {
    const element = ref.current
    if (inView || !element) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, inView, threshold])

  return inView
}

/**
 * A whole number that counts up to `target` once, easing out.
 *
 * About six tenths of a second: long enough to register as the number
 * arriving, short enough that nobody waits for it. Reduced motion gets
 * the target straight away.
 */
export function useCountUp(target, duration = 600, from = 0) {
  const reduced = prefersReducedMotion()
  const [shown, setShown] = useState(reduced ? target : from)

  useEffect(() => {
    if (reduced || !Number.isFinite(target)) return undefined
    let frame
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1)
      setShown(Math.round(from + (target - from) * (1 - (1 - t) ** 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, from, reduced])

  return reduced || !Number.isFinite(target) ? target : shown
}
