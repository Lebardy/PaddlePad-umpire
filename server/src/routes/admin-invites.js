import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { recordActivity } from '../admin-activity.js'
import { inviteCodeHint, inviteExpiryDays } from '../admin-rules.js'
import { cancelInvite, createInvite, listInvites } from '../invite-store.js'
import { facilityFilterFor } from '../facility-rules.js'
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

/** A request body/query's raw facilityId, or null when it isn't a well-formed id. */
function requestedFacilityId(value) {
  return isUuid(value) ? value : null
}

router.get('/', async (req, res) => {
  // listInvites expects the object shape { query }, not the bare query
  // function -- it calls db.query(...), not db(...).
  const filter = facilityFilterFor(req.admin, requestedFacilityId(req.query.facilityId))
  const invites = await listInvites({ query }, filter)
  res.json({ invites: invites.map(toInvitePayload) })
})

router.post('/', async (req, res) => {
  const note = String(req.body?.note ?? '').trim().slice(0, NOTE_MAX) || null
  const expiry = inviteExpiryDays(req.body)
  if (expiry.error) return res.status(400).json({ error: expiry.error })

  // The owner must choose a real facility; a facility admin's code is
  // always their own -- anything they sent for facilityId is ignored;
  // a facility-less admin (facilityFilterFor -> { none }) has none to
  // fall back to either.
  const filter = facilityFilterFor(req.admin, requestedFacilityId(req.body?.facilityId))
  const facility = filter.id ? await findFacility(query, filter.id) : null
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
  // owner may cancel any; a facility-less admin cancels nothing.
  const filter = facilityFilterFor(req.admin, null)
  const cancelled = await withTransaction(async (client) => {
    const row = await cancelInvite(client, req.params.code, filter)
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
