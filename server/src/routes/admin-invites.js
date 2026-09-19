import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { recordActivity } from '../admin-activity.js'
import { inviteCodeHint, inviteExpiryDays } from '../admin-rules.js'
import { cancelInvite, createInvite, listInvites } from '../invite-store.js'
import { findFacility } from '../facility-store.js'
import { isUuid } from '../validate.js'

// Invite codes gate umpire accounts, so making them is an admin's job.
const router = Router()
router.use(requireAdminAccount(query))

const NOTE_MAX = 120

/** The store's raw row, with its facility fields renamed to match the rest of the API. */
function toInvitePayload(row) {
  const { facility_id: facilityId, facility_name: facilityName, ...rest } = row
  return { ...rest, facilityId: facilityId ?? null, facilityName: facilityName ?? null }
}

router.get('/', async (req, res) => {
  // The owner may filter by a facility (or see everyone by leaving it
  // off); a facility admin is always pinned to their own.
  const facilityId = req.admin.role === 'owner'
    ? (isUuid(req.query.facilityId) ? req.query.facilityId : undefined)
    : (req.admin.facilityId ?? null)
  const invites = await listInvites(query, { facilityId })
  res.json({ invites: invites.map(toInvitePayload) })
})

router.post('/', async (req, res) => {
  const note = String(req.body?.note ?? '').trim().slice(0, NOTE_MAX) || null
  const expiry = inviteExpiryDays(req.body)
  if (expiry.error) return res.status(400).json({ error: expiry.error })

  // The owner must choose a real facility; a facility admin's code is
  // always their own -- anything they sent for facilityId is ignored.
  const requestedFacilityId = req.admin.role === 'owner' ? req.body?.facilityId : req.admin.facilityId
  const facility = isUuid(requestedFacilityId) ? await findFacility(query, requestedFacilityId) : null
  if (!facility) return res.status(400).json({ error: 'Choose a facility' })

  const invite = await withTransaction(async (client) => {
    const created = await createInvite(client, {
      note, days: expiry.days, createdByAdmin: req.admin.id, facilityId: facility.id,
    })
    await recordActivity(client, {
      adminId: req.admin.id, action: 'invite.created', targetType: 'invite', targetId: inviteCodeHint(created.code),
      summary: `Made invite code ${inviteCodeHint(created.code)}${note ? ` for ${note}` : ''}`,
    })
    return created
  })
  res.status(201).json({ invite: toInvitePayload(invite) })
})

router.delete('/:code', async (req, res) => {
  // A facility admin may only cancel their own facility's codes; the
  // owner may cancel any.
  const facilityId = req.admin.role === 'owner' ? undefined : (req.admin.facilityId ?? null)
  const cancelled = await withTransaction(async (client) => {
    const row = await cancelInvite(client, req.params.code, { facilityId })
    if (row) {
      await recordActivity(client, {
        adminId: req.admin.id, action: 'invite.cancelled', targetType: 'invite', targetId: inviteCodeHint(row.code),
        summary: `Cancelled invite code ${inviteCodeHint(row.code)}${row.note ? ` for ${row.note}` : ''}`,
      })
    }
    return row
  })
  if (!cancelled) return res.status(404).json({ error: 'No unused invite with that code' })
  res.status(204).end()
})

export default router
