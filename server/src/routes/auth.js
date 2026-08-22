import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  requireAuth,
  signToken,
  verifyPassword,
} from '../auth.js'
import { normalizeInviteCode } from '../invites.js'

const router = Router()

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

// Lets the very first umpire register before any invite can exist.
// Only honoured while the umpires table is empty, so it stops working
// the moment a real account exists rather than remaining a permanent
// back door. Unset it in Railway once you've signed up.
const BOOTSTRAP_INVITE_CODE = process.env.BOOTSTRAP_INVITE_CODE

/**
 * Claims a single-use invite, or accepts the bootstrap code while no
 * umpires exist yet.
 *
 * Runs inside the caller's transaction and marks the invite used in
 * the same breath as creating the umpire. That ordering matters: a
 * check-then-insert would let two people submitting the same code
 * concurrently both pass the check and both get accounts. Here the
 * UPDATE only matches while `used_by IS NULL`, so the second one
 * matches zero rows and its whole transaction rolls back.
 *
 * @returns {Promise<string|null>} an error message, or null on success
 */
async function claimInvite(client, rawCode, umpireId) {
  const code = normalizeInviteCode(rawCode)

  if (BOOTSTRAP_INVITE_CODE) {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM umpires')
    // The new umpire is already inserted at this point, so "empty
    // before this registration" means exactly one row.
    if (rows[0].n === 1 && code === normalizeInviteCode(BOOTSTRAP_INVITE_CODE)) {
      // The founding umpire becomes the admin, and is the only account
      // that gets the flag automatically -- everyone who joins later
      // arrives through an invite and stays a plain umpire.
      await client.query('UPDATE umpires SET is_admin = true WHERE id = $1', [
        umpireId,
      ])
      return null
    }
  }

  if (!code) return 'An invite code is required'

  const { rowCount } = await client.query(
    `UPDATE invites
        SET used_by = $2, used_at = now()
      WHERE code = $1
        AND used_by IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [code, umpireId],
  )

  // One message for "wrong", "already used" and "expired" alike, so
  // the endpoint can't be used to probe which codes exist.
  return rowCount === 1 ? null : 'That invite code is not valid'
}

router.post('/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const name = String(req.body?.name ?? '').trim()
  const password = String(req.body?.password ?? '')
  const invite = req.body?.invite

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' })
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Email looks invalid' })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    })
  }

  const password_hash = await hashPassword(password)

  try {
    const umpire = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO umpires (email, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, name`,
        [email, name, password_hash],
      )
      const created = rows[0]

      const inviteError = await claimInvite(client, invite, created.id)
      if (inviteError) {
        // Rolls back the umpire insert above.
        const failure = new Error(inviteError)
        failure.statusCode = 403
        throw failure
      }

      // Re-read is_admin rather than using the INSERT's value: the
      // founding umpire has the flag set by claimInvite() above, after
      // that insert already returned.
      const { rows: flags } = await client.query(
        'SELECT is_admin FROM umpires WHERE id = $1',
        [created.id],
      )
      return { ...created, is_admin: flags[0].is_admin }
    })

    res.status(201).json({ token: signToken(umpire), umpire })
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message })
    }
    // 23505 = unique_violation on umpires_email_lower_idx
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already registered' })
    }
    throw error
  }
})

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')

  const { rows } = await query(
    `SELECT id, email, name, password_hash, is_admin
       FROM umpires
      WHERE lower(email) = $1`,
    [email],
  )
  const found = rows[0]

  // Hash a throwaway password when the email is unknown so that a
  // missing account and a wrong password take similar time to answer,
  // and both return the same message -- neither reveals whether an
  // email is registered.
  const ok = found
    ? await verifyPassword(password, found.password_hash)
    : await verifyPassword(password, `${'0'.repeat(32)}:${'0'.repeat(128)}`)

  if (!found || !ok) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }

  const umpire = {
    id: found.id,
    email: found.email,
    name: found.name,
    is_admin: found.is_admin,
  }
  res.json({ token: signToken(umpire), umpire })
})

// Lets the app confirm a stored token is still valid on launch, so an
// expired session shows the login screen instead of failing later on
// the first real request mid-match.
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, name, is_admin FROM umpires WHERE id = $1',
    [req.umpire.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' })
  res.json({ umpire: rows[0] })
})

export default router
