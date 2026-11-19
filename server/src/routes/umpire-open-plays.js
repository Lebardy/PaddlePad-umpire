import { Router } from 'express'
import { query } from '../db.js'
import { requireActiveUmpire, requireAuth } from '../auth.js'
import { COURT_LEAD_MS } from '../court-rules.js'
import { loadCourtState } from '../open-play-store.js'

const router = Router()
router.use(requireAuth, requireActiveUmpire(query))

/** The courts this umpire's place has open tonight: from an hour before each open play until it ends. */
router.get('/today', async (req, res) => {
  if (!req.umpire.facilityId) return res.json({ openPlays: [] })
  const now = new Date()
  const { rows: plays } = await query(
    `SELECT id, starts_at, ends_at, court_numbers FROM open_plays
      WHERE facility_id = $1 AND umpire AND starts_at - $2::int * interval '1 millisecond' <= $3 AND ends_at >= $3
      ORDER BY starts_at`,
    [req.umpire.facilityId, COURT_LEAD_MS, now],
  )
  const state = await loadCourtState(query, plays.map((p) => p.id))
  res.json({
    openPlays: plays.map((p) => ({
      id: p.id,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      courts: p.court_numbers.map((court) => {
        const slot = state.get(p.id).get(court)
        const assignee = slot?.assignee?.active ? slot.assignee : null
        return {
          court,
          assignedTo: !assignee ? null : assignee.id === req.umpire.id ? 'me' : 'other',
          started: Boolean(slot?.session),
        }
      }),
    })),
  })
})

export default router
