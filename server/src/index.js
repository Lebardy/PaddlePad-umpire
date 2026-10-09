import cors from 'cors'
import express from 'express'
import { migrate, pool } from './db.js'
import { RATE_LIMITS_DISABLED, rateLimit } from './ratelimit.js'
import { requestLog } from './requestlog.js'
import authRoutes from './routes/auth.js'
// Umpire-facing: search, create and manage the player registry.
import playerAdminRoutes from './routes/players.js'
import sessionRoutes from './routes/sessions.js'
import matchRoutes from './routes/matches.js'
// Player-facing: a claimed player reading their OWN history.
import playerSelfRoutes from './routes/player.js'
// Service-to-service: the ML pipeline reading match logs and writing
// back a ratings snapshot. Guarded by a shared key, not by a token.
import internalRoutes from './routes/internal.js'
import smokeTidyRoutes from './routes/smoke-tidy.js'
// Admin site: its own accounts, guarded by the admin token role.
import adminAuthRoutes from './routes/admin-auth.js'
import adminAdminsRoutes from './routes/admin-admins.js'
import adminInviteRoutes from './routes/admin-invites.js'
import adminActivityRoutes from './routes/admin-activity.js'
import adminFacilitiesRoutes from './routes/admin-facilities.js'
import adminOverviewRoutes from './routes/admin-overview.js'
import { adminPlayersRoutes, adminUmpiresRoutes } from './routes/admin-people.js'
import logoRoutes from './routes/logos.js'

const app = express()

// Railway sits in front of this, so req.ip would otherwise be the
// proxy's address for every caller and the rate limiter would treat
// the whole internet as one client.
//
// The hop count matters: it is how Express knows which X-Forwarded-For
// entry is the real client rather than one the caller wrote themselves.
// Raising it without adding a real proxy hands anyone a free bypass of
// every rate limit below.
app.set('trust proxy', 1)

if (RATE_LIMITS_DISABLED) {
  console.warn(
    '\n*** RATE LIMITS ARE DISABLED (DANGEROUSLY_DISABLE_RATE_LIMITS=1) ***\n' +
      '*** Password, invite-code and claim-code guessing are unthrottled. ***\n' +
      '*** This is for automated tests only. Never set it on a deploy.  ***\n',
  )
}

// Fine for local development, where the admin site really does run at
// the localhost fallback (see setupUrl in admin-accounts.js). Anywhere
// else this means a setup link just handed to a new admin points at
// nobody's machine but yours.
if (!process.env.ADMIN_ORIGIN) {
  console.warn(
    'ADMIN_ORIGIN is not set. Any admin setup link created here will point at ' +
      'http://localhost:5175 rather than the deployed admin site.',
  )
}

app.use(express.json({ limit: '1mb' }))
app.use(requestLog)

// The app is served from a different origin than the API (Vite in dev,
// a static host in production), so CORS has to be explicit. Set
// CORS_ORIGIN in Railway to the deployed app's URL; the default allows
// only local dev origins.
const allowedOrigins = (
  process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      // Requests with no Origin header (curl, health checks) are fine.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      callback(new Error(`Origin not allowed: ${origin}`))
    },
  }),
)

// Railway health checks hit this; it also confirms the database is
// actually reachable rather than just that the process is up.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true })
  } catch {
    res.status(503).json({ ok: false, error: 'Database unreachable' })
  }
})

// The unauthenticated endpoints are the ones exposed to guessing --
// passwords on /login, invite codes on /register -- so they're capped
// per IP. Generous enough that a person fumbling their password won't
// notice, tight enough that scripted guessing is useless.
app.use('/auth/login', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/auth/register', rateLimit({ max: 5, windowMs: 60_000 }))
// Login-grade, and it does real work per request: verifying a Google
// token can mean fetching Google's public keys. Also the door to
// creating an umpire account, so it gets register's scrutiny too.
//
// A NESTED path runs both limiters, not one. app.use('/auth/google')
// matches /auth/google/link as well, so a request there is counted in
// its own bucket AND in the parent's, and the effective cap is the
// tighter of the two. That is safe -- never looser than intended -- but
// it means the parent's number is a ceiling on every path beneath it,
// which is easy to forget when raising or lowering either one.
app.use('/auth/google/link', rateLimit({ max: 10, windowMs: 60_000 }))
// 20 rather than login's 10 because FOUR paths now share this bucket --
// /auth/google, /link, /connect and /disconnect -- and everyone at a venue behind one
// wifi address shares it. The same mistake was already
// made and fixed on the player side: a parent limit sized for one
// endpoint quietly became the ceiling on connecting Google at all.
app.use('/auth/google', rateLimit({ max: 20, windowMs: 60_000 }))

// Guessing a current password is the point of a limit here, exactly as
// on /auth/login. The Google connect and disconnect routes sit under
// /auth/google and are already covered by its ceiling above; this one
// is not under anything, so it needs its own.
app.use('/auth/me/password', rateLimit({ max: 10, windowMs: 60_000 }))
// PATCH /auth/me asks for the password too when the email is changing,
// so it cannot be left uncapped either. Looser than the one above
// because GET /auth/me runs on every launch; the nested mount above
// keeps password guessing at the tighter number.
app.use('/auth/me', rateLimit({ max: 30, windowMs: 60_000 }))

// Mistyped player names are the realistic spam vector on an otherwise
// trusted API. Limits count per address and a venue's wifi is ONE
// address, so this is sized for all its umpires searching at once.
app.use('/players', rateLimit({ max: 300, windowMs: 60_000 }))
// A claim code is a bearer credential, so this gets a login-grade limit
// rather than a read-grade one. 60/min against a code space would be far
// too generous for something that grants access on its own.
app.use('/auth/player/claim', rateLimit({ max: 10, windowMs: 60_000 }))
// Same grade for the account endpoints, and register is the tighter of
// the two: besides guessing passwords it can be used to probe which
// names are already on the roster, since a taken name has to be
// answered differently from a free one.
app.use('/auth/player/register', rateLimit({ max: 5, windowMs: 60_000 }))
app.use('/auth/player/login', rateLimit({ max: 10, windowMs: 60_000 }))
// Login-grade too, and for the same reason: this endpoint now takes a
// `currentPassword` to authorise a change, which makes it a password-
// guessing surface even though it needs a valid token to reach.
app.use('/auth/player/credentials', rateLimit({ max: 10, windowMs: 60_000 }))
// Login-grade rather than register-grade, even though this endpoint can
// create a player account and its refusals distinguish a free name from
// one already on the roster -- the same roster-probing surface
// /auth/player/register has at 5/min. The difference is the cost of an
// attempt: every request here has to carry a Google token that Google
// itself will vouch for, where /auth/player/register needs nothing at
// all.
//
// It was 5, and that was wrong for a second reason. Per the note above,
// a request to .../google/link is counted in the parent bucket too, so
// 5 here would have been the real ceiling on connecting Google as well
// as on signing in with it -- and a venue sharing one wifi address
// shares one bucket.
app.use('/auth/player/google/link', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/auth/player/google/unlink', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/auth/player/google', rateLimit({ max: 10, windowMs: 60_000 }))
// Takes a claim code, so it is a bearer-credential guessing surface and
// gets the same login-grade limit /auth/player/claim does -- the limit
// below would be far too generous. Mounted first so it keys its own
// bucket rather than sharing /player's.
app.use('/player/link', rateLimit({ max: 10, windowMs: 60_000 }))
// Sized for a whole venue on one wifi address opening the app in the
// same minute, a few requests each -- not for one phone.
app.use('/player', rateLimit({ max: 300, windowMs: 60_000 }))
// One caller, a handful of calls per run. Tight enough that a leaked
// key cannot be used to scrape the whole match log repeatedly,
// loose enough for a nightly run plus a few manual triggers in a demo.
app.use('/internal', rateLimit({ max: 20, windowMs: 60_000 }))

// The admin site. Sign-in, setup links and password changes are
// guessing surfaces, so they get login-grade limits; the parent limit
// below is the ceiling on everything under /admin, nested paths
// included (see the note on /auth/google above).
// Logos are pictures on a page: a list of facilities asks for one per
// row, so they get a generous limit of their own rather than spending
// /admin's 120 a minute (see the Facilities "countdown" fix).
app.use('/logos', rateLimit({ max: 600, windowMs: 60_000 }))

app.use('/admin/auth/login', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin/auth/backup-code', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin/auth/google', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin/auth/setup', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin/auth/me/password', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin/auth/me/google', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin/auth/me/backup-codes', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/admin', rateLimit({ max: 120, windowMs: 60_000 }))

app.use('/auth', authRoutes)
app.use('/players', playerAdminRoutes)
app.use('/sessions', sessionRoutes)
app.use('/matches', matchRoutes)
app.use('/player', playerSelfRoutes)
// Staging only: the smoke test removing what it made. Unset anywhere
// else, so on production the path is simply not there.
if (process.env.SMOKE_TIDY === 'on') app.use('/internal/smoke-tidy', smokeTidyRoutes)
app.use('/internal', internalRoutes)
app.use('/admin/auth', adminAuthRoutes)
app.use('/admin/admins', adminAdminsRoutes)
app.use('/admin/invites', adminInviteRoutes)
app.use('/admin/activity', adminActivityRoutes)
app.use('/admin/facilities', adminFacilitiesRoutes)
app.use('/admin/overview', adminOverviewRoutes)
app.use('/admin/players', adminPlayersRoutes)
app.use('/admin/umpires', adminUmpiresRoutes)
app.use('/logos', logoRoutes)

// An id that is not an id (Postgres code 22P02), or a date that is not
// a date. Such a request can never succeed, so it must not look like a
// server fault: the umpire app retries a 5xx for ever and holds
// everything queued behind it, while a 4xx is set aside.
const isUnreadableInput = (error) =>
  error.code === '22P02' || (error instanceof RangeError && error.message === 'Invalid time value')

// Express 5 forwards rejected promises from async handlers here, so
// route handlers don't each need their own try/catch.
app.use((error, _req, res, _next) => {
  console.error(error)
  if (/Origin not allowed/.test(error.message)) return res.status(403).json({ error: error.message })
  if (isUnreadableInput(error)) {
    return res.status(400).json({ error: 'That request has an id or a date the server cannot read' })
  }
  res.status(500).json({ error: 'Server error' })
})

const port = process.env.PORT ?? 3000

migrate()
  .then(() => {
    app.listen(port, () => {
      console.log(`PaddlePad API listening on :${port}`)
    })
  })
  .catch((error) => {
    console.error('Failed to apply schema:', error)
    process.exit(1)
  })
