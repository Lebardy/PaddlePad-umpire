import { useEffect, useState } from 'react'

// Follows the system setting live, so turning reduced motion on stops
// the loop without a reload.
export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const update = () => setReduced(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return reduced
}

export function useOnScreen(ref, threshold = 0.25) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const seen = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting), { threshold })
    if (ref.current) seen.observe(ref.current)
    return () => seen.disconnect()
  }, [ref, threshold])
  return on
}
