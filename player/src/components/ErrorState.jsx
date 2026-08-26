// ============================================================
// A failed load, with a way out of it.
//
// The previous version was a red paragraph and nothing else: if the
// first load failed, the app was a dead end until the player thought to
// reload the page themselves.
//
// Being unreachable is treated as its own case rather than as an error.
// Courtside wifi drops constantly, and telling someone the app is broken
// when their signal is the problem is both wrong and unhelpful -- the
// action they need is "try again in a moment", not "report a bug".
// ============================================================

function ErrorState({ message, onRetry }) {
  // api.js sets this exact wording with status 0 when fetch itself
  // rejects, which is the network-level failure rather than a response.
  const offline =
    /can't reach the server/i.test(message ?? '') || navigator.onLine === false

  return (
    <div className="error-state" role="alert">
      <p className="error-state-title">
        {offline ? 'No connection' : 'Something went wrong'}
      </p>
      <p className="error-state-body">
        {offline
          ? 'Your matches are safe — this device just can’t reach the server right now.'
          : message}
      </p>
      {onRetry && (
        <button type="button" className="retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export default ErrorState
