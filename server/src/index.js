import cors from 'cors'
import express from 'express'
import { migrate, pool } from './db.js'
import { RATE_LIMITS_DISABLED, rateLimit } from './ratelimit.js'
import { requestLog } from './requestlog.js'
import authRoutes from './routes/auth.js'
import inviteRoutes from './routes/invites.js'
// Umpire-facing: search, create and manage the player registry.
import playerAdminRoutes from './routes/players.js'
import sessionRoutes from './routes/sessions.js'
import matchRoutes from './routes/matches.js'
import exportRoutes from './routes/export.js'
// Player-facing: a claimed player reading their OWN history.
import playerSelfRoutes from './routes/player.js'
// Service-to-service: the ML pipeline reading match logs and writing
// back a ratings snapshot. Guarded by a shared key, not by a token.
import internalRoutes from './routes/internal.js'

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
// Mounted before /auth/google so it keys its own bucket rather than
// sharing one -- it takes a password, which /auth/google does not, and
// that makes it a guessing surface in its own right.
app.use('/auth/google/link', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/auth/google', rateLimit({ max: 10, windowMs: 60_000 }))

// Mistyped player names are the realistic spam vector on an otherwise
// trusted API, and the export is the only genuinely expensive query.
app.use('/players', rateLimit({ max: 60, windowMs: 60_000 }))
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
// Register-grade rather than login-grade, because this is the door to
// CREATING a player account as well as returning to one, and its
// refusals distinguish a free name from one already on the roster --
// the same roster-probing surface /auth/player/register has. Verifying
// a Google token also costs a call out to Google per request.
//
// link and unlink are mounted first so they key their own buckets: they
// take a currentPassword, which makes them password-guessing surfaces
// that the sign-in endpoint is not.
app.use('/auth/player/google/link', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/auth/player/google/unlink', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/auth/player/google', rateLimit({ max: 5, windowMs: 60_000 }))
// Takes a claim code, so it is a bearer-credential guessing surface and
// gets the same login-grade limit /auth/player/claim does -- the 60/min
// below would be far too generous. Mounted first so it keys its own
// bucket rather than sharing /player's.
app.use('/player/link', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/player', rateLimit({ max: 60, windowMs: 60_000 }))
app.use('/export', rateLimit({ max: 5, windowMs: 60_000 }))
// One caller, a handful of calls per run. Tight enough that a leaked
// key cannot be used to scrape the whole club's match log repeatedly,
// loose enough for a nightly run plus a few manual triggers in a demo.
app.use('/internal', rateLimit({ max: 20, windowMs: 60_000 }))

app.use('/auth', authRoutes)
app.use('/invites', inviteRoutes)
app.use('/players', playerAdminRoutes)
app.use('/sessions', sessionRoutes)
app.use('/matches', matchRoutes)
app.use('/export', exportRoutes)
app.use('/player', playerSelfRoutes)
app.use('/internal', internalRoutes)

// Express 5 forwards rejected promises from async handlers here, so
// route handlers don't each need their own try/catch.
app.use((error, _req, res, _next) => {
  console.error(error)
  const status = /Origin not allowed/.test(error.message) ? 403 : 500
  res.status(status).json({ error: status === 403 ? error.message : 'Server error' })
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
