// ============================================================
// Invite codes: the only way a new umpire can create an account.
// ============================================================

import { generateInviteCode } from './invites.js'

/** Every code with its status, newest first. */
export async function listInvites(db) {
  const { rows } = await db.query(
    `SELECT i.code,
            i.note,
            i.expires_at,
            i.created_at,
            i.used_at,
            claimer.name AS used_by_name,
            COALESCE(admin_creator.name, umpire_creator.name) AS created_by_name,
            (i.created_by_admin IS NULL AND i.created_by IS NOT NULL) AS made_before_admin_site,
            CASE
              WHEN i.used_by IS NOT NULL THEN 'used'
              WHEN i.expires_at IS NOT NULL AND i.expires_at <= now() THEN 'expired'
              ELSE 'open'
            END AS status
       FROM invites i
       LEFT JOIN admins admin_creator ON admin_creator.id = i.created_by_admin
       LEFT JOIN umpires umpire_creator ON umpire_creator.id = i.created_by
       LEFT JOIN umpires claimer ON claimer.id = i.used_by
      ORDER BY i.created_at DESC`,
  )
  return rows
}

/** `days` null means the code never expires. */
export async function createInvite(db, { note, days, createdByAdmin }) {
  const { rows } = await db.query(
    `INSERT INTO invites (code, note, created_by_admin, expires_at)
     VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL
                              ELSE now() + make_interval(days => $4::int) END)
     RETURNING code, note, expires_at, created_at`,
    [generateInviteCode(), note, createdByAdmin, days],
  )
  return rows[0]
}

/** Deletes an unused code. Used codes are kept as the record of who joined with which. */
export async function cancelInvite(db, code) {
  const { rows } = await db.query(
    'DELETE FROM invites WHERE code = $1 AND used_by IS NULL RETURNING code, note',
    [code],
  )
  return rows[0] ?? null
}
