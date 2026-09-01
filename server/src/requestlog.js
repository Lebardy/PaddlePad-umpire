// ============================================================
// Request logging.
//
// Added after a session went missing and there was no way to tell who
// had deleted it. The data itself was trivial, but "I think it was
// probably you" is not an acceptable answer about someone's records --
// especially now that umpires can cancel sessions and void matches,
// which are exactly the actions worth being able to account for.
//
// Deliberately minimal: one line per request, no bodies. Bodies would
// mean passwords, invite codes and claim codes landing in the log,
// which turns an audit trail into a credential leak.
// ============================================================

// Health checks fire constantly and say nothing about who did what.
const IGNORED = new Set(['/health'])

// Reads are noise at this scale. Writes are the ones anyone will ever
// need to reconstruct.
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function requestLog(req, res, next) {
  if (IGNORED.has(req.path)) return next()

  const started = process.hrtime.bigint()

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6

    // Log every mutation, but only failed reads -- a successful GET is
    // rarely worth a line, while a 403 on one is worth knowing about.
    const isMutation = MUTATIONS.has(req.method)
    if (!isMutation && res.statusCode < 400) return

    // requireAuth / requirePlayer attach these; an unauthenticated
    // request logs as anonymous rather than being dropped, since failed
    // sign-in attempts are worth seeing.
    const actor = req.umpire
      ? `umpire:${req.umpire.id}`
      : req.player
        ? `player:${req.player.id}`
        : 'anon'

    // req.ip, resolved from the `trust proxy` hop count, rather than the
    // first X-Forwarded-For entry -- that entry is whatever the caller
    // chose to send. Railway's edge overwrites the header, so the values
    // logged here were accurate in practice, but an audit trail is the
    // last place to keep a field the subject of the audit can set.
    const ip = req.ip

    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(ms),
        actor,
        ip,
      }),
    )
  })

  next()
}
