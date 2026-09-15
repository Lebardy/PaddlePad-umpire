import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { recordActivity } from '../admin-activity.js'
import { inviteCodeHint, inviteExpiryDays } from '../admin-rules.js'
import { cancelInvite, createInvite, listInvites } from '../invite-store.js'

// Invite codes gate umpire accounts, so making them is an admin's job.
const router = Router()
router.use(requireAdminAccount(query))

const NOTE_MAX = 120

router.get('/', async (_req, res) => {
  res.json({ invites: await listInvites({ query }) })
})

router.post('/', async (req, res) => {
  const note = String(req.body?.note ?? '').trim().slice(0, NOTE_MAX) || null
  const expiry = inviteExpiryDays(req.body)
  if (expiry.error) return res.status(400).json({ error: expiry.error })

  const invite = await withTransaction(async (client) => {
    const created = await createInvite(client, { note, days: expiry.days, createdByAdmin: req.admin.id })
    await recordActivity(client, {
      adminId: req.admin.id, action: 'invite.created', targetType: 'invite', targetId: inviteCodeHint(created.code),
      summary: `Made invite code ${inviteCodeHint(created.code)}${note ? ` for ${note}` : ''}`,
    })
    return created
  })
  res.status(201).json({ invite })
})

router.delete('/:code', async (req, res) => {
  const cancelled = await withTransaction(async (client) => {
    const row = await cancelInvite(client, req.params.code)
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
