import { Router } from 'express'
import { query } from '../db.js'
import { requireAdmin, requireAuth } from '../auth.js'
import { generateInviteCode } from '../invites.js'

const router = Router()

// Invite codes are what gate account creation, so issuing them is
// restricted to admins -- not merely to anyone already signed in.
// Otherwise every umpire invited could invite others, and control over
// who gets an account would spread beyond the project owner within a
// couple of hops.
router.use(requireAuth)
router.use(requireAdmin(query))

const DEFAULT_EXPIRY_DAYS = 14

/**
 * Creates a single-use invite code.
 *
 * Codes expire by default rather than living forever, so one texted
 * to the wrong number or left in a chat log stops working on its own.
 * Pass `expiresInDays: null` for a code that doesn't expire.
 */
router.post('/', async (req, res) => {
  const note = String(req.body?.note ?? '').trim() || null

  const hasExplicitExpiry = 'expiresInDays' in (req.body ?? {})
  const requestedDays = hasExplicitExpiry
    ? req.body.expiresInDays
    : DEFAULT_EXPIRY_DAYS

  if (requestedDays !== null) {
    const days = Number(requestedDays)
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return res
        .status(400)
        .json({ error: 'expiresInDays must be between 1 and 365, or null' })
    }
  }

  const code = generateInviteCode()

  const { rows } = await query(
    `INSERT INTO invites (code, created_by, note, expires_at)
     VALUES ($1, $2, $3, CASE WHEN $4::numeric IS NULL
                              THEN NULL
                              ELSE now() + ($4 || ' days')::interval END)
     RETURNING code, note, expires_at, created_at`,
    [code, req.umpire.id, note, requestedDays === null ? null : Number(requestedDays)],
  )

  res.status(201).json({ invite: rows[0] })
})

/** Lists invites with their status, newest first. */
router.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT i.code,
            i.note,
            i.expires_at,
            i.created_at,
            i.used_at,
            creator.name AS created_by_name,
            claimer.name AS used_by_name,
            CASE
              WHEN i.used_by IS NOT NULL THEN 'used'
              WHEN i.expires_at IS NOT NULL AND i.expires_at <= now() THEN 'expired'
              ELSE 'open'
            END AS status
       FROM invites i
       LEFT JOIN umpires creator ON creator.id = i.created_by
       LEFT JOIN umpires claimer ON claimer.id = i.used_by
      ORDER BY i.created_at DESC`,
  )
  res.json({ invites: rows })
})

/**
 * Revokes an unused invite. Used codes are kept rather than deleted so
 * the record of who invited whom survives.
 */
router.delete('/:code', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM invites WHERE code = $1 AND used_by IS NULL',
    [req.params.code],
  )
  if (rowCount === 0) {
    return res
      .status(404)
      .json({ error: 'No unused invite with that code' })
  }
  res.status(204).end()
})

export default router
