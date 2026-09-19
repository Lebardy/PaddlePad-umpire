import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { facilityFilterFor } from '../facility-rules.js'
import { recordActivity } from '../admin-activity.js'
import {
  NOT_FLAGGED_MESSAGE, NOT_OVERVIEW_VOID_MESSAGE, REASONS, pairKey, readVoidReason,
} from '../overview-rules.js'
import { loadMatchForAction, loadOverview, matchLabel, matchReasonsNow } from '../overview-store.js'
import { invalidateRallyRatings } from '../rally-rating-store.js'
import { isUuid } from '../validate.js'

// The admin site's landing page. A facility admin only ever gets their
// own facility; the owner gets every facility or the one they pick,
// plus the possible duplicate players, which only the owner sees.
const router = Router()
router.use(requireAdminAccount(query))

function refusal(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/** Sends a refusal thrown inside a transaction, or rethrows anything else. */
function sendRefusal(res, error) {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
  throw error
}

/**
 * Whether this admin may act on a match: the owner on any, a facility
 * admin only on their own facility's. A match outside that answers
 * "No such match", the same as one that doesn't exist.
 */
function mayActOn(admin, row) {
  const filter = facilityFilterFor(admin, null)
  if (filter.all) return true
  return Boolean(filter.id && row.facility_id === filter.id)
}

const REASON_WORDS = {
  stuck: 'stuck in progress', ended_early: 'ended early', shutout: 'a shutout', short: 'very short', long: 'very long',
}

router.get('/', async (req, res) => {
  const filter = facilityFilterFor(req.admin, isUuid(req.query.facilityId) ? req.query.facilityId : null)
  res.json(await loadOverview(query, filter, { isOwner: req.admin.role === 'owner', adminId: req.admin.id }))
})

router.post('/looks-fine', async (req, res) => {
  const { matchId, reason } = req.body ?? {}
  if (!isUuid(matchId) || !REASONS.includes(reason)) return res.status(400).json({ error: 'Say which match and which warning' })
  try {
    await withTransaction(async (client) => {
      const row = await loadMatchForAction(client.query.bind(client), matchId, { lock: true })
      if (!row || !mayActOn(req.admin, row)) throw refusal(404, 'No such match')
      const current = await matchReasonsNow(client.query.bind(client), row)
      if (!current.some((r) => r.reason === reason)) throw refusal(409, 'That warning is already gone')
      await client.query(
        `INSERT INTO dismissed_warnings (kind, match_id, reason, facility_id, admin_id)
         VALUES ('match', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [matchId, reason, row.facility_id, req.admin.id],
      )
      await recordActivity(client, {
        adminId: req.admin.id, action: 'match.looks_fine', targetType: 'match', targetId: matchId, facilityId: row.facility_id,
        summary: `Marked ${await matchLabel(client.query.bind(client), row)} as fine (was ${REASON_WORDS[reason]})`,
      })
    })
    res.json({ ok: true })
  } catch (error) {
    sendRefusal(res, error)
  }
})

router.post('/void', async (req, res) => {
  const { matchId } = req.body ?? {}
  if (!isUuid(matchId)) return res.status(400).json({ error: 'Say which match' })
  const read = readVoidReason(req.body?.reason)
  if (read.error) return res.status(400).json({ error: read.error })
  try {
    await withTransaction(async (client) => {
      const q = client.query.bind(client)
      const row = await loadMatchForAction(q, matchId, { lock: true })
      if (!row || !mayActOn(req.admin, row)) throw refusal(404, 'No such match')
      if (row.voided_at) throw refusal(409, 'That match is already voided')
      const reasons = await matchReasonsNow(q, row)
      if (reasons.length === 0) throw refusal(409, NOT_FLAGGED_MESSAGE)
      await client.query(
        `UPDATE matches SET voided_at = now(), voided_by = NULL, voided_by_admin = $2, void_reason = $3 WHERE id = $1`,
        [matchId, req.admin.id, read.reason],
      )
      await recordActivity(client, {
        adminId: req.admin.id, action: 'match.voided', targetType: 'match', targetId: matchId, facilityId: row.facility_id,
        summary: `Voided ${await matchLabel(q, row)} (${reasons.map((r) => r.tag).join(', ')}). Reason: ${read.reason}`,
      })
    })
    invalidateRallyRatings()
    res.json({ ok: true })
  } catch (error) {
    sendRefusal(res, error)
  }
})

router.post('/unvoid', async (req, res) => {
  const { matchId } = req.body ?? {}
  if (!isUuid(matchId)) return res.status(400).json({ error: 'Say which match' })
  try {
    await withTransaction(async (client) => {
      const q = client.query.bind(client)
      const row = await loadMatchForAction(q, matchId, { lock: true })
      if (!row || !mayActOn(req.admin, row)) throw refusal(404, 'No such match')
      if (!row.voided_at || !row.voided_by_admin) throw refusal(409, NOT_OVERVIEW_VOID_MESSAGE)
      await client.query(
        'UPDATE matches SET voided_at = NULL, voided_by = NULL, voided_by_admin = NULL, void_reason = NULL WHERE id = $1',
        [matchId],
      )
      await recordActivity(client, {
        adminId: req.admin.id, action: 'match.restored', targetType: 'match', targetId: matchId, facilityId: row.facility_id,
        summary: `Undid the void on ${await matchLabel(q, row)}`,
      })
    })
    invalidateRallyRatings()
    res.json({ ok: true })
  } catch (error) {
    sendRefusal(res, error)
  }
})

router.post('/not-same-person', async (req, res) => {
  if (req.admin.role !== 'owner') return res.status(403).json({ error: 'Only the owner can do that' })
  const ids = req.body?.playerIds
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(isUuid) || ids[0] === ids[1]) {
    return res.status(400).json({ error: 'Say which two players' })
  }
  const [a, b] = pairKey(ids[0], ids[1]).split(':')
  const { rows } = await query('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [[a, b]])
  if (rows.length !== 2) return res.status(404).json({ error: 'No such player' })
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO dismissed_warnings (kind, player_a, player_b, admin_id) VALUES ('players', $1, $2, $3) ON CONFLICT DO NOTHING`,
      [a, b, req.admin.id],
    )
    await recordActivity(client, {
      adminId: req.admin.id, action: 'player.not_duplicate', targetType: 'player', targetId: a,
      summary: `Marked ${nameOf.get(a)} and ${nameOf.get(b)} as two different people`,
    })
  })
  res.json({ ok: true })
})

export default router
