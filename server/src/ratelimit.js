// Small in-memory rate limiter for the unauthenticated endpoints.
//
// Deliberately not a package: the need here is narrow (slow down
// password and invite-code guessing against a public API) and the
// whole thing is ~30 lines. It counts per IP in this process only, so
// it would need replacing with a shared store if the API ever runs on
// more than one instance -- noted rather than solved, since a single
// Railway instance is the current shape.

const buckets = new Map()

// Old buckets are swept lazily on each call rather than on a timer, so
// this never holds an interval open or leaks entries for IPs that
// stopped calling.
function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * @param {object} options
 * @param {number} options.max      allowed requests per window
 * @param {number} options.windowMs window length in milliseconds
 */
export function rateLimit({ max, windowMs }) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now()
    if (buckets.size > 5000) sweep(now)

    // Railway terminates TLS upstream, so the client address arrives in
    // X-Forwarded-For. Only the first entry is meaningful; the rest can
    // be spoofed by the caller.
    const forwarded = req.get('x-forwarded-for')
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip

    const key = `${req.path}:${ip}`
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    bucket.count += 1
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: `Too many attempts. Try again in ${retryAfter} seconds.`,
      })
    }
    next()
  }
}
