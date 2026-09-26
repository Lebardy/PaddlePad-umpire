import { Router } from 'express'
import { query } from '../db.js'
import { readFacilityLogo } from '../facility-store.js'
import { isUuid } from '../validate.js'

// Facility logos, for an <img> on the admin site or in the player app.
// No sign-in: a picture on a page can't carry the app's token, and a
// facility's logo is public anyway. The apps always ask with ?v=<when it
// last changed>, which is what makes the year-long cache safe -- a new
// logo is a new address.
const router = Router()

router.get('/:facilityId', async (req, res) => {
  if (!isUuid(req.params.facilityId)) return res.status(404).end()
  const logo = await readFacilityLogo(query, req.params.facilityId, req.query.size === 'small' ? 'small' : 'full')
  if (!logo) return res.status(404).end()
  res.set({
    'Content-Type': logo.mime_type,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.send(logo.bytes)
})

export default router
