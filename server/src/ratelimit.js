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

    // The FIRST X-Forwarded-For entry, deliberately, and NOT req.ip.
    //
    // req.ip looks like the principled choice -- let Express resolve the
    // client from the `trust proxy` hop count. It was tried, deployed,
    // and silently disabled this limiter in production. Railway's edge
    // does not present as one hop: req.ip came back as a rotating pool
    // of Railway's own addresses (152.233.15.120/121/123,
    // 152.233.68.97/98) rather than the caller. Every request therefore
    // got its own bucket and nothing was ever limited. Eleven attempts
    // against a limit of ten all passed.
    //
    // Railway OVERWRITES X-Forwarded-For rather than appending to it, so
    // its first entry is the real client and a caller cannot inject a
    // value that survives -- verified from the production request log,
    // where requests sent with a spoofed header were recorded under the
    // true address.
    //
    // That last sentence is the load-bearing one, and it is a fact about
    // THIS deployment, not about proxies generally. Behind a proxy that
    // appends, the first entry is attacker-controlled and this becomes a
    // free bypass. If this app ever moves off Railway, or is exposed
    // without a proxy in front, revisit this line first.
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
    const forwarded = req.get('x-forwarded-for')
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip

    const key = `${req.baseUrl || req.path}:${ip}`
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
