import { Router } from 'express'
import { pool, query, withTransaction } from '../db.js'
import {
  MIN_PASSWORD_LENGTH,
  NO_SUCH_ACCOUNT_HASH,
  hashPassword,
  requireAdminAccount,
  signAdminToken,
  verifyPassword,
} from '../auth.js'
import { googleConfigured, resolveGoogleProfile } from '../google.js'
import { ADMIN_COLUMNS, resetSessions } from '../admin-accounts.js'
import { recordActivity } from '../admin-activity.js'
import { countBackupCodesLeft, dummyBackupCodeCheck, replaceBackupCodes, useBackupCode } from '../admin-backup-codes.js'
import {
  adminPayload,
  canDisconnectGoogle,
  hashSetupSecret,
  normalizeEmail,
  proofFromSession,
  setupLinkState,
} from '../admin-rules.js'

const router = Router()

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
  // Pinned to the row's own sessions_reset_at, exactly as every other
  // mint point is: without it, a sign-in in the seconds right after a
  // reset could be signed with an iat that a Postgres clock running
  // ahead makes look like it predates that same reset, and the very
  // next request would refuse the token this response just handed back.
  return { token: signAdminToken(row, row.sessions_reset_at), admin: adminPayload(row) }
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

const REPROOF_REFUSAL = 'Sign in with the Google account connected to your admin account'

/**
 * Proof that the person making a sign-in change is really the admin,
 * not just someone holding their token: their current password, or --
 * for a Google-only admin -- a Google sign-in done again right now.
 *
 * Returns true when proven. On failure it sends the 403 itself and
 * returns false, so callers just `if (!(await requireReproof(...))) return`.
 * A failed attempt writes no activity record.
 *
 * A session opened with a backup code counts as proof on its own (see
 * proofFromSession): that code is exactly how an owner who has lost
 * their password proves who they are, so demanding the password they
 * no longer have here would turn every one of their ten sign-ins into
 * a dead end instead of a way to repair the account.
 */
async function requireReproof(req, res, me) {
  if (proofFromSession(req.admin)) return true

  if (me.password_hash) {
    const ok = await verifyPassword(String(req.body?.currentPassword ?? ''), me.password_hash)
    if (ok) return true
    res.status(403).json({ error: 'Your current password is wrong' })
    return false
  }

  let profile
  try {
    profile = await resolveGoogleProfile({
      accessToken: req.body?.reproofAccessToken,
      credential: req.body?.reproofCredential,
    })
  } catch (error) {
    // A missing or invalid token is a failed re-proof: 403, same as a
    // mismatched account below. Anything the resolver signals as a
    // server-side failure (Google not configured, Google unreachable)
    // is not about who is asking, so it is answered as itself, the way
    // googleProfile() does above -- and anything with no statusCode at
    // all is a bug, not a refusal, so it is left to bubble up.
    if (!error.statusCode) throw error
    if (error.statusCode >= 500) {
      res.status(error.statusCode).json({ error: error.message })
      return false
    }
    res.status(403).json({ error: REPROOF_REFUSAL })
    return false
  }
  if (profile.sub !== me.google_sub) {
    res.status(403).json({ error: REPROOF_REFUSAL })
    return false
  }
  return true
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
    const { row, resetAt } = await withTransaction(async (client) => {
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
      // A setup link is how a locked-out or compromised admin is
      // re-linked, so any session token issued before this moment --
      // however that admin got hold of one -- must stop working too.
      const resetAt = await resetSessions(client, rows[0].id)
      await recordActivity(client, {
        adminId: rows[0].id,
        action: 'admin.setup_completed',
        targetType: 'admin',
        targetId: rows[0].id,
        summary: `${rows[0].name} finished setting up with ${profile ? 'Google' : 'a password'}`,
      })
      return { row: rows[0], resetAt }
    })
    res.json({ token: signAdminToken(row, resetAt), admin: adminPayload(row) })
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
  const me = await loadMe(req.admin.id)
  res.json({
    admin: adminPayload(me),
    backupCodesLeft: me.role === 'owner' ? await countBackupCodesLeft(query, me.id) : null,
    // Straight off the session (see requireAdminAccount / proofFromSession),
    // not the row: it is true only while this particular token still
    // counts as its own proof, and the site reads it fresh here rather
    // than remembering it from the moment someone signed in.
    viaBackupCode: Boolean(req.admin.viaBackupCode),
  })
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

  if (!(await requireReproof(req, res, me))) return
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
  }

  const passwordHash = await hashPassword(newPassword)
  const { row, resetAt } = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE admins SET password_hash = $2 WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
      [me.id, passwordHash],
    )
    const resetAt = await resetSessions(client, me.id)
    await recordActivity(client, {
      adminId: me.id, action: 'admin.password_changed', targetType: 'admin', targetId: me.id,
      summary: `${me.name} ${me.password_hash ? 'changed' : 'set'} their password`,
    })
    return { row: rows[0], resetAt }
  })
  // The fresh token carries no extra claim, so a session that got in on
  // a backup code stops counting as its own proof from here on.
  res.json({ token: signAdminToken(row, resetAt), admin: adminPayload(row), viaBackupCode: false })
})

router.post('/me/google/connect', async (req, res) => {
  const me = await loadMe(req.admin.id)
  if (!(await requireReproof(req, res, me))) return
  const profile = await googleProfile(req, res)
  if (!profile) return
  try {
    const { row, resetAt } = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE admins SET google_sub = $2, google_email = $3 WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
        [req.admin.id, profile.sub, profile.email],
      )
      const resetAt = await resetSessions(client, req.admin.id)
      await recordActivity(client, {
        adminId: req.admin.id, action: 'admin.google_connected', targetType: 'admin', targetId: req.admin.id,
        summary: `${req.admin.name} connected Google (${profile.email})`,
      })
      return { row: rows[0], resetAt }
    })
    res.json({ token: signAdminToken(row, resetAt), admin: adminPayload(row), viaBackupCode: false })
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
  if (!(await requireReproof(req, res, me))) return
  const { row, resetAt } = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE admins SET google_sub = NULL, google_email = NULL WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
      [me.id],
    )
    const resetAt = await resetSessions(client, me.id)
    await recordActivity(client, {
      adminId: me.id, action: 'admin.google_disconnected', targetType: 'admin', targetId: me.id,
      summary: `${me.name} disconnected Google`,
    })
    return { row: rows[0], resetAt }
  })
  res.json({ token: signAdminToken(row, resetAt), admin: adminPayload(row), viaBackupCode: false })
})

router.post('/me/sign-out-others', async (req, res) => {
  const resetAt = await withTransaction(async (client) => {
    const resetAt = await resetSessions(client, req.admin.id)
    await recordActivity(client, {
      adminId: req.admin.id, action: 'admin.signed_out_others', targetType: 'admin', targetId: req.admin.id,
      summary: `${req.admin.name} signed out everywhere else`,
    })
    return resetAt
  })
  const row = await loadMe(req.admin.id)
  // Even though this route needs no proof itself, the fresh token drops
  // the backup-code claim, so the site's shortcut for the next change
  // must drop with it.
  res.json({ token: signAdminToken(row, resetAt), admin: adminPayload(row), viaBackupCode: false })
})

router.post('/me/backup-codes', async (req, res) => {
  const me = await loadMe(req.admin.id)
  if (me.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner has backup codes' })
  }
  if (!(await requireReproof(req, res, me))) return

  const { codes, resetAt } = await withTransaction(async (client) => {
    const codes = await replaceBackupCodes(client, me.id)
    const resetAt = await resetSessions(client, me.id)
    await recordActivity(client, {
      adminId: me.id, action: 'admin.backup_codes_created', targetType: 'admin', targetId: me.id,
      summary: `${me.name} made a new set of backup codes`,
    })
    return { codes, resetAt }
  })
  res.json({ codes, token: signAdminToken(me, resetAt), admin: adminPayload(me), viaBackupCode: false })
})

// ------------------------------------------------------------
// Signing in with a backup code
// ------------------------------------------------------------

router.post('/backup-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const typedCode = req.body?.code

  const { rows } = await query(`SELECT ${ADMIN_COLUMNS} FROM admins WHERE lower(email) = $1`, [email])
  const found = rows[0]

  let matched = false
  let row = null
  let resetAt = null

  if (found?.role === 'owner') {
    if (!found.deactivated_at) {
      const result = await withTransaction(async (client) => {
        const used = await useBackupCode(client, found.id, typedCode)
        if (!used) return { used: false }
        const reset = await resetSessions(client, found.id)
        const { rows: updated } = await client.query(
          `UPDATE admins SET last_signed_in_at = now() WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
          [found.id],
        )
        await recordActivity(client, {
          adminId: found.id, action: 'admin.backup_code_used', targetType: 'admin', targetId: found.id,
          summary: `${updated[0].name} signed in with a backup code`,
        })
        return { used: true, resetAt: reset, row: updated[0] }
      })
      matched = result.used
      if (matched) {
        resetAt = result.resetAt
        row = result.row
      }
    } else {
      // Switched off, so there is no real check to run -- but a
      // switched-off owner must not answer any faster than an active
      // one refusing a wrong code, or switched-off-ness itself would be
      // the thing response time gives away.
      await dummyBackupCodeCheck()
    }
    // The email really is the owner's, so a wrong or reused code (or an
    // attempt while switched off) is a real failed sign-in, logged
    // outside the refused transaction, exactly as /login does with pool.
    if (!matched) {
      await recordActivity(pool, {
        adminId: found.id, action: 'admin.sign_in_failed', targetType: 'admin', targetId: found.id,
        summary: `Failed sign-in for ${found.email}`,
      })
    }
  } else {
    // No admin, or a non-owner: nothing real to check, but this still
    // costs the same as a real attempt against ten codes, so guessing
    // at addresses can't be told apart from guessing at codes -- or
    // from an owner with codes left versus one who has none -- by
    // response time.
    await dummyBackupCodeCheck()
  }

  if (!matched) {
    return res.status(401).json({ error: "That email and backup code don't match" })
  }

  res.json({ token: signAdminToken(row, resetAt, { viaBackupCode: true }), admin: adminPayload(row), usedBackupCode: true })
})

export default router
