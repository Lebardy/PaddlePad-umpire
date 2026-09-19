// ============================================================
// Invite codes: the only way a new umpire can create an account.
// ============================================================

import { generateInviteCode } from './invites.js'

/**
 * Every code with its status, newest first.
 *
 * `facilityId` filters which codes come back: leave it out entirely for
 * no filter (the owner browsing everyone), pass a facility's id for
 * that facility only, or pass `null` for codes with no facility at all
 * -- the three are distinct, so a caller scoped to "no facility" can
 * never see another one by leaving the filter off.
 */
export async function listInvites(db, { facilityId } = {}) {
  const params = []
  let filter = 'TRUE'
  if (facilityId !== undefined) {
    if (facilityId === null) {
      filter = 'i.facility_id IS NULL'
    } else {
      params.push(facilityId)
      filter = `i.facility_id = $${params.length}`
    }
  }
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
      WHERE ${filter}
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
 * Deletes an unused code. Used codes are kept as the record of who
 * joined with which.
 *
 * `facilityId` scopes the delete the same way `listInvites` scopes a
 * read: left out for no restriction (the owner), a facility's id to
 * restrict to that facility, or `null` to restrict to codes with no
 * facility at all.
 */
export async function cancelInvite(db, code, { facilityId } = {}) {
  const params = [code]
  let filter = 'TRUE'
  if (facilityId !== undefined) {
    if (facilityId === null) {
      filter = 'facility_id IS NULL'
    } else {
      params.push(facilityId)
      filter = `facility_id = $${params.length}`
    }
  }
  const { rows } = await db.query(
    `DELETE FROM invites WHERE code = $1 AND used_by IS NULL AND (${filter}) RETURNING code, note`,
    params,
  )
  return rows[0] ?? null
}
