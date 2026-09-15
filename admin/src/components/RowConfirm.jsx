import { useEffect, useRef, useState } from 'react'

/**
 * A row button that asks "are you sure?" in place, instead of a browser
 * confirm box. The screen decides which row is asking (`open`); this
 * keeps what a confirm box gave for free: focus goes back to the button
 * that opened it, Escape closes it, and the request can only be sent
 * once. While it runs the buttons stay put, and a failure is said right
 * here in the row, where the admin is looking.
 */
export default function RowConfirm({
  label, className, question, confirmLabel, confirmClass, busyLabel, keepLabel = 'Keep',
  open, hidden = false, onOpen, onClose, onConfirm,
}) {
  const trigger = useRef(null)
  const returnFocus = useRef(false)
  // A ref as well as state, so a quick second click can't send it twice.
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Only when this confirmation closed itself: another row opening its
  // own confirmation must keep the focus it just took.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false
      trigger.current?.focus()
    }
  }, [open])

  function close() {
    returnFocus.current = true
    onClose()
  }

  async function confirm() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message)
    } finally {
      running.current = false
      setBusy(false)
      close()
    }
  }

  if (hidden) return null

  if (!open) {
    return (
      <>
        <button
          ref={trigger}
          type="button"
          className={className}
          onClick={() => { setError(null); onOpen() }}
        >
          {label}
        </button>
        {error && <span className="row-error" role="alert">{error}</span>}
      </>
    )
  }

  return (
    <span
      className="confirm"
      role="group"
      aria-label={label}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !running.current) {
          event.stopPropagation()
          close()
        }
      }}
    >
      <span className="confirm-text">{question}</span>
      <span className="confirm-buttons">
        {/* aria-disabled rather than disabled: a disabled button drops
            keyboard focus to the page, the thing this is here to avoid. */}
        <button type="button" className={confirmClass} aria-disabled={busy} onClick={confirm}>
          {busy ? busyLabel : confirmLabel}
        </button>
        {/* Focus lands on the safe choice. */}
        <button type="button" className="btn-quiet btn-small" autoFocus aria-disabled={busy}
          onClick={() => { if (!running.current) close() }}>
          {keepLabel}
        </button>
      </span>
    </span>
  )
}
