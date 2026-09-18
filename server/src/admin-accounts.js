// ============================================================
// Creating admins and their one-time setup links.
//
// Used by the owner's routes and by scripts/create-owner.mjs, so both
// make accounts and links exactly the same way.
// ============================================================

import { SETUP_LINK_HOURS, newSetupSecret } from './admin-rules.js'

export const ADMIN_COLUMNS =
  'id, name, email, role, password_hash, google_sub, google_email, deactivated_at, last_signed_in_at, created_at, sessions_reset_at, facility_id'

/** Where a setup link opens: the admin site, not the API. */
export function setupUrl(secret) {
  const origin = (process.env.ADMIN_ORIGIN ?? 'http://localhost:5175').replace(/\/$/, '')
  return `${origin}/setup/${secret}`
}

/** Inserts an admin with no way to sign in yet. Throws 23505 on a taken email or a second owner. */
export async function createAdmin(db, { name, email, role, createdBy, facilityId }) {
  const { rows } = await db.query(
    `INSERT INTO admins (name, email, role, created_by, facility_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${ADMIN_COLUMNS}`,
    [name, email, role, createdBy ?? null, facilityId ?? null],
  )
  return rows[0]
}

/**
 * Makes a new setup link for an admin, cancelling any unused one first,
 * so only the newest link an owner handed out can ever work.
 */
export async function createSetupLink(db, { adminId, createdBy }) {
  await db.query(
    `UPDATE admin_setup_links SET cancelled_at = now()
      WHERE admin_id = $1 AND used_at IS NULL AND cancelled_at IS NULL`,
    [adminId],
  )
  const { secret, hash } = newSetupSecret()
  const { rows } = await db.query(
    `INSERT INTO admin_setup_links (admin_id, secret_hash, expires_at, created_by)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4)
     RETURNING expires_at`,
    [adminId, hash, SETUP_LINK_HOURS, createdBy ?? null],
  )
  return { url: setupUrl(secret), expiresAt: rows[0].expires_at }
}

/**
 * Ends every session an admin currently holds: any token issued before
 * this moment stops working the next time it's used (see
 * requireAdminAccount and admin-rules.js sessionEnded). Called from the
 * same transaction as whatever earned it -- a password or Google
 * change, a switch-off, or the admin's own "sign out everywhere else".
 *
 * Returns the stored reset moment (Postgres's clock, not this server's)
 * so a token signed right after can be pinned to it -- see
 * signAdminToken's `resetAt` argument and admin-rules.js adminTokenIat.
 */
export async function resetSessions(db, adminId) {
  const { rows } = await db.query(
    'UPDATE admins SET sessions_reset_at = now() WHERE id = $1 RETURNING sessions_reset_at',
    [adminId],
  )
  return rows[0].sessions_reset_at
}
