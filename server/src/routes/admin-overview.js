import { Router } from 'express'
import { query } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { facilityFilterFor } from '../facility-rules.js'
import { loadOverview } from '../overview-store.js'
import { isUuid } from '../validate.js'

// The admin site's landing page. A facility admin only ever gets their
// own facility; the owner gets every facility or the one they pick,
// plus the possible duplicate players, which only the owner sees.
const router = Router()
router.use(requireAdminAccount(query))

router.get('/', async (req, res) => {
  const filter = facilityFilterFor(req.admin, isUuid(req.query.facilityId) ? req.query.facilityId : null)
  res.json(await loadOverview(query, filter, { isOwner: req.admin.role === 'owner', adminId: req.admin.id }))
})

export default router
