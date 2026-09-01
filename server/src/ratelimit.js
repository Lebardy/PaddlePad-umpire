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

// Test suites make dozens of deliberately-failing sign-in attempts in a
// few seconds, which is precisely the traffic these limits exist to
// stop. Named to be unmistakable in a Railway variables list: anyone
// setting this on a deployed service has to type the word DANGEROUSLY.
// index.js shouts about it at boot so it cannot be on quietly.
export const RATE_LIMITS_DISABLED =
  process.env.DANGEROUSLY_DISABLE_RATE_LIMITS === '1'

/**
 * @param {object} options
 * @param {number} options.max      allowed requests per window
 * @param {number} options.windowMs window length in milliseconds
 */
export function rateLimit({ max, windowMs }) {
  if (RATE_LIMITS_DISABLED) return (_req, _res, next) => next()

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now()
    if (buckets.size > 5000) sweep(now)

    // Railway terminates TLS upstream and appends the real client to
    // X-Forwarded-For, so req.ip -- which Express resolves using the
    // `trust proxy` hop count set in index.js -- is the trustworthy
    // entry.
    //
    // This used to read the header directly and take the FIRST entry,
    // which is exactly the one a caller can write for themselves:
    // proxies APPEND, so `X-Forwarded-For: 1.2.3.4` arrives as
    // `1.2.3.4, <real client>`. Every limit here was one header away
    // from being bypassed, on password guessing, invite codes and claim
    // codes alike. Do not reintroduce manual parsing; the hop count is
    // the only place that knowledge belongs.
    // req.baseUrl, NOT req.path. Express strips the mount path inside a
    // middleware added with app.use(path, mw), so req.path is '/' for
    // every limiter here -- meaning they all shared ONE bucket per IP.
    // Spending the 10 on /auth/login left /auth/register, untouched,
    // returning 429 on its first request. Verified before and after.
    //
    // The limits are per IP, so this could never let one caller exhaust
    // another's budget; it made unrelated endpoints starve each other,
    // which for a player typing a claim code looks like the app being
    // broken. req.baseUrl is the mount path itself, so each limiter
    // gets its own namespace with no call-site changes.
    const key = `${req.baseUrl || req.path}:${req.ip}`
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
