import { useEffect, useRef } from 'react'

/**
 * The one open/close pattern every Overview warning pop-up shares: the
 * screen decides the dialog exists at all (it's only mounted while
 * there's something to warn about), so as soon as it mounts it opens
 * itself with `showModal()`. Escape fires the browser's own `cancel`
 * event rather than a click, so that's routed to the same `onCancel`
 * the "Not now" button uses -- but never while a submit is in flight.
 */
export function useAutoDialog(onCancel, busy) {
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  function handleCancel(event) {
    event.preventDefault()
    if (!busy) onCancel()
  }

  return { ref, handleCancel }
}
