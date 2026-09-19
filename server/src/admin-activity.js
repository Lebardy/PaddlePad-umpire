// ============================================================
// The activity record: who did what, and when.
//
// Pass the same transaction client that makes the change, so the entry
// and the change are saved together or not at all. Nothing here, or
// anywhere else, updates or deletes an entry.
// ============================================================

import { ACTIONS } from './admin-rules.js'

/**
 * `facilityId` files the entry under a facility other than the admin's
 * own -- the owner has none, so an owner acting on one facility's match
 * passes that match's facility here and the facility's own admins see
 * it in their Activity too.
 */
export async function recordActivity(db, { adminId = null, action, targetType = null, targetId = null, summary, facilityId = null }) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown admin action: ${action}`)
  await db.query(
    `INSERT INTO admin_activity (admin_id, action, target_type, target_id, summary, facility_id)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, (SELECT facility_id FROM admins WHERE id = $1)))`,
    [adminId, action, targetType, targetId == null ? null : String(targetId), summary, facilityId],
  )
}
