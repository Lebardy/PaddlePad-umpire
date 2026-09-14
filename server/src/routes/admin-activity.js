import { Router } from 'express'
import { query } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { ACTIONS } from '../admin-rules.js'
import { isUuid } from '../validate.js'

// Read-only on purpose: there is no route that changes or deletes an entry.
const router = Router()
router.use(requireAdminAccount(query))

const PAGE = 50

router.get('/', async (req, res) => {
  const before = /^\d+$/.test(String(req.query.before ?? '')) ? String(req.query.before) : null
  const adminId = isUuid(req.query.adminId) ? req.query.adminId : null
  const action = ACTIONS.includes(req.query.action) ? req.query.action : null

  // One more than a page, to know whether there is an older page.
  const { rows } = await query(
    `SELECT e.id, e.action, e.target_type, e.target_id, e.summary, e.created_at, a.name AS admin_name
       FROM admin_activity e
       LEFT JOIN admins a ON a.id = e.admin_id
      WHERE ($1::bigint IS NULL OR e.id < $1::bigint)
        AND ($2::uuid IS NULL OR e.admin_id = $2::uuid)
        AND ($3::text IS NULL OR e.action = $3::text)
      ORDER BY e.id DESC
      LIMIT $4`,
    [before, adminId, action, PAGE + 1],
  )
  const page = rows.slice(0, PAGE)
  res.json({
    entries: page.map((row) => ({
      id: String(row.id),
      adminName: row.admin_name,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      createdAt: row.created_at,
    })),
    nextBefore: rows.length > PAGE ? String(page[page.length - 1].id) : null,
  })
})

/** What the filters can offer. Names only, so any admin may read it. */
router.get('/filters', async (_req, res) => {
  const { rows } = await query('SELECT id, name FROM admins ORDER BY name')
  res.json({ admins: rows, actions: ACTIONS })
})

export default router
