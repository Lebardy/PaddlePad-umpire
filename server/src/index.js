import cors from 'cors'
import express from 'express'
import { migrate, pool } from './db.js'
import { rateLimit } from './ratelimit.js'
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

const app = express()

// Railway sits in front of this, so req.ip would otherwise be the
// proxy's address for every caller and the rate limiter would treat
// the whole internet as one client.
app.set('trust proxy', 1)

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

// Mistyped player names are the realistic spam vector on an otherwise
// trusted API, and the export is the only genuinely expensive query.
app.use('/players', rateLimit({ max: 60, windowMs: 60_000 }))
// A claim code is a bearer credential, so this gets a login-grade limit
// rather than a read-grade one. 60/min against a code space would be far
// too generous for something that grants access on its own.
app.use('/auth/player/claim', rateLimit({ max: 10, windowMs: 60_000 }))
app.use('/player', rateLimit({ max: 60, windowMs: 60_000 }))
app.use('/export', rateLimit({ max: 5, windowMs: 60_000 }))

app.use('/auth', authRoutes)
app.use('/invites', inviteRoutes)
app.use('/players', playerAdminRoutes)
app.use('/sessions', sessionRoutes)
app.use('/matches', matchRoutes)
app.use('/export', exportRoutes)
app.use('/player', playerSelfRoutes)

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
