import { Router } from 'express'
import { query } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { ACTIONS } from '../admin-rules.js'
import { facilityScope } from '../facility-rules.js'
import { listFacilities } from '../facility-store.js'
import { isUuid } from '../validate.js'

// Read-only on purpose: there is no route that changes or deletes an entry.
const router = Router()
router.use(requireAdminAccount(query))

const PAGE = 50

router.get('/', async (req, res) => {
  const before = /^\d+$/.test(String(req.query.before ?? '')) ? String(req.query.before) : null
  const adminId = isUuid(req.query.adminId) ? req.query.adminId : null
  const action = ACTIONS.includes(req.query.action) ? req.query.action : null

  // The owner may filter by a facility, or leave it off to see
  // everyone; a facility admin only ever sees their own facility's
  // entries -- an admin with no facility (the owner, or the rare
  // account left unassigned) sees only the entries that also have none.
  const scope = facilityScope(req.admin)
  const params = [before, adminId, action]
  let facilityFilter = 'TRUE'
  if (scope === 'all') {
    if (isUuid(req.query.facilityId)) {
      params.push(req.query.facilityId)
      facilityFilter = `e.facility_id = $${params.length}`
    }
  } else if (scope) {
    params.push(scope)
    facilityFilter = `e.facility_id = $${params.length}`
  } else {
    facilityFilter = 'e.facility_id IS NULL'
  }
  params.push(PAGE + 1)

  // One more than a page, to know whether there is an older page.
  const { rows } = await query(
    `SELECT e.id, e.action, e.target_type, e.target_id, e.summary, e.created_at, a.name AS admin_name,
            f.name AS facility_name
       FROM admin_activity e
       LEFT JOIN admins a ON a.id = e.admin_id
       LEFT JOIN facilities f ON f.id = e.facility_id
      WHERE ($1::bigint IS NULL OR e.id < $1::bigint)
        AND ($2::uuid IS NULL OR e.admin_id = $2::uuid)
        AND ($3::text IS NULL OR e.action = $3::text)
        AND (${facilityFilter})
      ORDER BY e.id DESC
      LIMIT $${params.length}`,
    params,
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
      facilityName: row.facility_name ?? null,
      createdAt: row.created_at,
    })),
    nextBefore: rows.length > PAGE ? String(page[page.length - 1].id) : null,
  })
})

/** What the filters can offer. Names only, so any admin may read it. */
router.get('/filters', async (req, res) => {
  const scope = facilityScope(req.admin)
  const [{ rows: admins }, facilities] = await Promise.all([
    scope === 'all'
      ? query('SELECT id, name FROM admins ORDER BY name')
      : scope
        ? query('SELECT id, name FROM admins WHERE facility_id = $1 ORDER BY name', [scope])
        : query('SELECT id, name FROM admins WHERE facility_id IS NULL ORDER BY name'),
    listFacilities(query, scope),
  ])
  res.json({ admins, actions: ACTIONS, facilities: facilities.map((f) => ({ id: f.id, name: f.name })) })
})

export default router
