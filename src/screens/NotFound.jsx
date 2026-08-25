// Shown when a screen is opened for a session or match that isn't in
// the local cache.
//
// Before the server existed this was unreachable in practice, which is
// why several screens dereferenced their record with no guard. Now that
// records can exist on the server but not yet on this device -- or be
// deleted by another umpire -- "not here" is a real, reachable state
// rather than an impossible one.
function NotFound({ what = 'item', onBack }) {
  return (
    <div className="not-found">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>
      <p className="empty">
        That {what} isn&rsquo;t on this device. It may still be loading, or
        another umpire may have removed it.
      </p>
    </div>
  )
}

export default NotFound
