// ============================================================
// Invite codes: the only way a new umpire can create an account.
// ============================================================

import { generateInviteCode } from './invites.js'

/** Turns a facility-rules.js facilityFilterFor() result into a fixed SQL condition. */
function facilityClause(filter, column, params) {
  if (filter.id) {
    params.push(filter.id)
    return `${column} = $${params.length}`
  }
  if (filter.none) return 'FALSE'
  return 'TRUE'
}

/**
 * Every code with its status, newest first, scoped by `filter` (a
 * facility-rules.js `facilityFilterFor()` result: `{ all }`, `{ id }`
 * or `{ none }`).
 */
export async function listInvites(db, filter = { all: true }) {
  const params = []
  const where = facilityClause(filter, 'i.facility_id', params)
  const { rows } = await db.query(
    `SELECT i.code,
            i.note,
            i.expires_at,
            i.created_at,
            i.used_at,
            i.facility_id,
            f.name AS facility_name,
            claimer.name AS used_by_name,
            COALESCE(admin_creator.name, umpire_creator.name) AS created_by_name,
            (i.created_by_admin IS NULL AND i.created_by IS NOT NULL) AS made_before_admin_site,
            CASE
              WHEN i.used_by IS NOT NULL THEN 'used'
              WHEN i.expires_at IS NOT NULL AND i.expires_at <= now() THEN 'expired'
              ELSE 'open'
            END AS status
       FROM invites i
       LEFT JOIN facilities f ON f.id = i.facility_id
       LEFT JOIN admins admin_creator ON admin_creator.id = i.created_by_admin
       LEFT JOIN umpires umpire_creator ON umpire_creator.id = i.created_by
       LEFT JOIN umpires claimer ON claimer.id = i.used_by
      WHERE ${where}
      ORDER BY i.created_at DESC`,
    params,
  )
  return rows
}

/** `days` null means the code never expires. */
export async function createInvite(db, { note, days, createdByAdmin, facilityId }) {
  const { rows } = await db.query(
    `INSERT INTO invites (code, note, created_by_admin, facility_id, expires_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL
                              ELSE now() + make_interval(days => $5::int) END)
     RETURNING code, note, expires_at, created_at, facility_id`,
    [generateInviteCode(), note, createdByAdmin, facilityId, days],
  )
  return rows[0]
}

/**
 * Deletes an unused code, scoped by `filter` the same way `listInvites`
 * is. Used codes are kept as the record of who joined with which.
 */
export async function cancelInvite(db, code, filter = { all: true }) {
  const params = [code]
  const where = facilityClause(filter, 'facility_id', params)
  const { rows } = await db.query(
    `DELETE FROM invites WHERE code = $1 AND used_by IS NULL AND (${where}) RETURNING code, note`,
    params,
  )
  return rows[0] ?? null
}
