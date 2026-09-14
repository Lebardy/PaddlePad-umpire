import { Router } from 'express'
import { pool, query, withTransaction } from '../db.js'
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  requireAdminAccount,
  signAdminToken,
  verifyPassword,
} from '../auth.js'
import { googleConfigured, resolveGoogleProfile } from '../google.js'
import { ADMIN_COLUMNS } from '../admin-accounts.js'
import { recordActivity } from '../admin-activity.js'
import {
  adminPayload,
  canDisconnectGoogle,
  hashSetupSecret,
  normalizeEmail,
  setupLinkState,
} from '../admin-rules.js'

const router = Router()

// Checked against when there is no usable hash, so a missing account, a
// Google-only account and a wrong password all take about as long to
// answer. Same shape and reason as routes/auth.js.
const NO_SUCH_ACCOUNT_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`

const LINK_GONE = 'This setup link no longer works. Ask the owner for a new one.'
const NAME_MAX = 80

/** Records the sign-in and returns what the site stores. */
async function completeSignIn(adminId) {
  const row = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE admins SET last_signed_in_at = now() WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
      [adminId],
    )
    await recordActivity(client, {
      adminId,
      action: 'admin.signed_in',
      targetType: 'admin',
      targetId: adminId,
      summary: `${rows[0].name} signed in`,
    })
    return rows[0]
  })
  return { token: signAdminToken(row), admin: adminPayload(row) }
}

/** A Google profile from the request, or a response already sent. */
async function googleProfile(req, res) {
  try {
    return await resolveGoogleProfile(req.body ?? {})
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message })
      return null
    }
    throw error
  }
}

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')

  const { rows } = await query(`SELECT ${ADMIN_COLUMNS} FROM admins WHERE lower(email) = $1`, [email])
  const found = rows[0]
  const ok = found?.password_hash
    ? await verifyPassword(password, found.password_hash)
    : await verifyPassword(password, NO_SUCH_ACCOUNT_HASH)

  if (!found || !found.password_hash || !ok) {
    // Only for a real admin's email, so guessing at random addresses
    // cannot flood the record.
    if (found) {
      await recordActivity(pool, {
        adminId: found.id,
        action: 'admin.sign_in_failed',
        targetType: 'admin',
        targetId: found.id,
        summary: `Failed sign-in for ${found.email}`,
      })
    }
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  // Said only after the right password, so it reveals nothing to a guesser.
  if (found.deactivated_at) {
    return res.status(403).json({ error: 'Your admin access has been switched off' })
  }

  res.json(await completeSignIn(found.id))
})

router.post('/google', async (req, res) => {
  const profile = await googleProfile(req, res)
  if (!profile) return

  // Matched on google_sub only. Google proves who someone is; it never
  // makes them an admin, so an unknown Google account is simply refused.
  const { rows } = await query(
    `UPDATE admins SET google_email = $2
      WHERE google_sub = $1 AND deactivated_at IS NULL
      RETURNING id`,
    [profile.sub, profile.email],
  )
  if (!rows[0]) {
    return res.status(401).json({ error: "That Google account isn't connected to an admin account" })
  }
  res.json(await completeSignIn(rows[0].id))
})

/** The link and its admin, looked up by the hash of the secret. */
async function findLink(secret) {
  const { rows } = await query(
    `SELECT l.used_at, l.cancelled_at, l.expires_at,
            a.id AS admin_id, a.name, a.email, a.deactivated_at
       FROM admin_setup_links l
       JOIN admins a ON a.id = l.admin_id
      WHERE l.secret_hash = $1`,
    [hashSetupSecret(secret)],
  )
  return rows[0]
}

router.get('/setup/:secret', async (req, res) => {
  const link = await findLink(req.params.secret)
  if (setupLinkState(link) !== 'usable' || link.deactivated_at) {
    return res.status(410).json({ error: LINK_GONE })
  }
  res.json({ admin: { name: link.name, email: link.email }, googleConfigured: googleConfigured() })
})

router.post('/setup/:secret', async (req, res) => {
  const password = req.body?.password == null ? null : String(req.body.password)
  const wantsGoogle = Boolean(req.body?.accessToken || req.body?.credential)

  if (password === null && !wantsGoogle) {
    return res.status(400).json({ error: 'Choose a password or connect Google' })
  }
  if (password !== null && password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
  }

  // Checked before anything is written, so a bad Google token never
  // uses up the link.
  const before = await findLink(req.params.secret)
  if (setupLinkState(before) !== 'usable' || before.deactivated_at) {
    return res.status(410).json({ error: LINK_GONE })
  }

  let profile = null
  if (wantsGoogle) {
    profile = await googleProfile(req, res)
    if (!profile) return
  }
  const passwordHash = password === null ? null : await hashPassword(password)

  try {
    const row = await withTransaction(async (client) => {
      // The UPDATE is the real single-use guard: of two requests racing
      // with the same link, only one can match.
      const { rows: used } = await client.query(
        `UPDATE admin_setup_links SET used_at = now()
          WHERE secret_hash = $1 AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > now()
          RETURNING admin_id`,
        [hashSetupSecret(req.params.secret)],
      )
      if (!used[0]) {
        const error = new Error(LINK_GONE)
        error.statusCode = 410
        throw error
      }
      const { rows } = await client.query(
        `UPDATE admins
            SET password_hash = COALESCE($2, password_hash),
                google_sub = COALESCE($3, google_sub),
                google_email = COALESCE($4, google_email),
                last_signed_in_at = now()
          WHERE id = $1 AND deactivated_at IS NULL
          RETURNING ${ADMIN_COLUMNS}`,
        [used[0].admin_id, passwordHash, profile?.sub ?? null, profile?.email ?? null],
      )
      if (!rows[0]) {
        const error = new Error(LINK_GONE)
        error.statusCode = 410
        throw error
      }
      await recordActivity(client, {
        adminId: rows[0].id,
        action: 'admin.setup_completed',
        targetType: 'admin',
        targetId: rows[0].id,
        summary: `${rows[0].name} finished setting up with ${profile ? 'Google' : 'a password'}`,
      })
      return rows[0]
    })
    res.json({ token: signAdminToken(row), admin: adminPayload(row) })
  } catch (error) {
    if (error.statusCode === 410) return res.status(410).json({ error: LINK_GONE })
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That Google account is already connected to another admin' })
    }
    throw error
  }
})

// ------------------------------------------------------------
// An admin's own account
// ------------------------------------------------------------

router.use('/me', requireAdminAccount(query))

async function loadMe(id) {
  const { rows } = await query(`SELECT ${ADMIN_COLUMNS} FROM admins WHERE id = $1`, [id])
  return rows[0]
}

router.get('/me', async (req, res) => {
  res.json({ admin: adminPayload(await loadMe(req.admin.id)) })
})

router.patch('/me', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name || name.length > NAME_MAX) {
    return res.status(400).json({ error: `Name must be 1 to ${NAME_MAX} characters` })
  }
  const { rows } = await query(
    `UPDATE admins SET name = $2 WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
    [req.admin.id, name],
  )
  res.json({ admin: adminPayload(rows[0]) })
})

router.post('/me/password', async (req, res) => {
  const me = await loadMe(req.admin.id)
  const newPassword = String(req.body?.newPassword ?? '')

  if (me.password_hash && !(await verifyPassword(String(req.body?.currentPassword ?? ''), me.password_hash))) {
    return res.status(403).json({ error: 'Your current password is wrong' })
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
  }

  const passwordHash = await hashPassword(newPassword)
  const row = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE admins SET password_hash = $2 WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
      [me.id, passwordHash],
    )
    await recordActivity(client, {
      adminId: me.id, action: 'admin.password_changed', targetType: 'admin', targetId: me.id,
      summary: `${me.name} ${me.password_hash ? 'changed' : 'set'} their password`,
    })
    return rows[0]
  })
  res.json({ admin: adminPayload(row) })
})

router.post('/me/google/connect', async (req, res) => {
  const profile = await googleProfile(req, res)
  if (!profile) return
  try {
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE admins SET google_sub = $2, google_email = $3 WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
        [req.admin.id, profile.sub, profile.email],
      )
      await recordActivity(client, {
        adminId: req.admin.id, action: 'admin.google_connected', targetType: 'admin', targetId: req.admin.id,
        summary: `${req.admin.name} connected Google (${profile.email})`,
      })
      return rows[0]
    })
    res.json({ admin: adminPayload(row) })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That Google account is already connected to another admin' })
    }
    throw error
  }
})

router.post('/me/google/disconnect', async (req, res) => {
  const me = await loadMe(req.admin.id)
  if (!me.google_sub) return res.status(409).json({ error: 'No Google account is connected.' })
  if (!canDisconnectGoogle(me)) {
    return res.status(409).json({ error: 'Set a password first. Google is your only way in, and there are no reset emails.' })
  }
  const row = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE admins SET google_sub = NULL, google_email = NULL WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
      [me.id],
    )
    await recordActivity(client, {
      adminId: me.id, action: 'admin.google_disconnected', targetType: 'admin', targetId: me.id,
      summary: `${me.name} disconnected Google`,
    })
    return rows[0]
  })
  res.json({ admin: adminPayload(row) })
})

export default router
