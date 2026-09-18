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

// A setup link's secret and an invite code both live in the path, not
// the body, so the usual "no bodies" guard above doesn't cover them --
// logging either whole would put a still-usable secret in Railway's
// logs for anyone who can read them. Each pattern only ever matches the
// one segment it means to redact, so nothing else in the path is touched.
function redactPath(path) {
  return path
    .replace(/\/admin\/auth\/setup\/[^/]+/, '/admin/auth/setup/…')
    .replace(/\/admin\/invites\/[^/]+/, '/admin/invites/…')
}

export function requestLog(req, res, next) {
  if (IGNORED.has(req.path)) return next()

  const started = process.hrtime.bigint()

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6

    // Log every mutation, but only failed reads -- a successful GET is
    // rarely worth a line, while a 403 on one is worth knowing about.
    const isMutation = MUTATIONS.has(req.method)
    if (!isMutation && res.statusCode < 400) return

    // requireAuth / requirePlayer / requireAdminAccount attach these; an
    // unauthenticated request logs as anonymous rather than being
    // dropped, since failed sign-in attempts are worth seeing. Checked
    // in this order because an admin token never satisfies the other
    // two guards, but the reverse isn't tested elsewhere -- admin is
    // asked first so an admin request is never misreported as anon.
    const actor = req.admin
      ? `admin:${req.admin.id}`
      : req.umpire
        ? `umpire:${req.umpire.id}`
        : req.player
          ? `player:${req.player.id}`
          : 'anon'

    // The first X-Forwarded-For entry, for the reason set out at length
    // in ratelimit.js: on Railway that is the real client, while req.ip
    // resolves to a rotating pool of Railway's own proxy addresses and
    // is useless for saying who did something.
    const forwarded = req.get('x-forwarded-for')
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip

    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        path: redactPath(req.originalUrl.split('?')[0]),
        status: res.statusCode,
        ms: Math.round(ms),
        actor,
        ip,
      }),
    )
  })

  next()
}
