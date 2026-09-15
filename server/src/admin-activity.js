// ============================================================
// The activity record: who did what, and when.
//
// Pass the same transaction client that makes the change, so the entry
// and the change are saved together or not at all. Nothing here, or
// anywhere else, updates or deletes an entry.
// ============================================================

import { ACTIONS } from './admin-rules.js'

export async function recordActivity(db, { adminId = null, action, targetType = null, targetId = null, summary }) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown admin action: ${action}`)
  await db.query(
    `INSERT INTO admin_activity (admin_id, action, target_type, target_id, summary)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, targetType, targetId == null ? null : String(targetId), summary],
  )
}
