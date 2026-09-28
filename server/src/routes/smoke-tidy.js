// ============================================================
// POST /internal/smoke-tidy -- the smoke test removing what it made.
//
// Mounted only when SMOKE_TIDY=on, which is set on staging and nowhere
// else, so on production this path does not exist at all. Behind the
// internal key as well. See src/smoke-tidy.js for what it deletes.
// ============================================================

import { Router } from 'express'
import { withTransaction } from '../db.js'
import { requireInternalKey } from '../auth.js'
import { readTidyRequest, tidySmokeRun } from '../smoke-tidy.js'

const router = Router()
router.use(requireInternalKey)

router.post('/', async (req, res) => {
  const read = readTidyRequest(req.body)
  if (read.error) return res.status(400).json({ error: read.error })
  const removed = await withTransaction((client) => tidySmokeRun(client, read.values))
  res.json({ removed })
})

export default router
