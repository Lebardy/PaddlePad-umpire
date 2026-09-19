import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount, requireOwner } from '../auth.js'
import { ADMIN_COLUMNS, createAdmin, createSetupLink, resetSessions } from '../admin-accounts.js'
import { recordActivity } from '../admin-activity.js'
import { adminPayload, isAdminEmail, normalizeEmail } from '../admin-rules.js'
import { findFacility } from '../facility-store.js'
import { isUuid } from '../validate.js'

// Adding, switching off and re-linking admins is the owner's alone, so
// admin powers cannot spread past the person responsible for them.
const router = Router()
router.use(requireAdminAccount(query), requireOwner)

const NAME_MAX = 80

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

router.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT ${ADMIN_COLUMNS} FROM admins ORDER BY (role = 'owner') DESC, created_at`,
  )
  res.json({ admins: rows.map(adminPayload) })
})

router.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const email = normalizeEmail(req.body?.email)
  if (!name || name.length > NAME_MAX) {
    return res.status(400).json({ error: `Name must be 1 to ${NAME_MAX} characters` })
  }
  if (!isAdminEmail(email)) return res.status(400).json({ error: 'Email looks invalid' })

  const facility = isUuid(req.body?.facilityId) ? await findFacility(query, req.body.facilityId) : null
  if (!facility) return res.status(400).json({ error: 'Choose a facility' })

  try {
    const { admin, setupLink } = await withTransaction(async (client) => {
      const created = await createAdmin(client, {
        name, email, role: 'admin', createdBy: req.admin.id, facilityId: facility.id,
      })
      const link = await createSetupLink(client, { adminId: created.id, createdBy: req.admin.id })
      await recordActivity(client, {
        adminId: req.admin.id, action: 'admin.added', targetType: 'admin', targetId: created.id,
        summary: `Added ${name} (${email}) and made their setup link`,
      })
      return { admin: created, setupLink: link }
    })
    res.status(201).json({ admin: adminPayload(admin), setupLink })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An admin with that email already exists' })
    }
    throw error
  }
})

router.post('/:id/setup-link', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'No such admin' })
  try {
    const setupLink = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT id, name, deactivated_at FROM admins WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows[0]) throw refusal(404, 'No such admin')
      if (rows[0].deactivated_at) throw refusal(409, 'Switch this admin back on before making them a link')
      const link = await createSetupLink(client, { adminId: rows[0].id, createdBy: req.admin.id })
      await recordActivity(client, {
        adminId: req.admin.id, action: 'admin.setup_link_created', targetType: 'admin', targetId: rows[0].id,
        summary: `Made a new setup link for ${rows[0].name}`,
      })
      return link
    })
    res.json({ setupLink })
  } catch (error) {
    sendRefusal(res, error)
  }
})

/** Switches an admin off (on = false) or back on. The owner cannot be switched off. */
function switchRoute(on) {
  return async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'No such admin' })
    try {
      const row = await withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT ${ADMIN_COLUMNS} FROM admins WHERE id = $1 FOR UPDATE`, [req.params.id])
        const target = rows[0]
        if (!target) throw refusal(404, 'No such admin')
        if (target.role === 'owner') throw refusal(409, "You can't switch off the owner")
        if (Boolean(target.deactivated_at) === !on) throw refusal(409, `This admin is already switched ${on ? 'on' : 'off'}`)

        const { rows: updated } = await client.query(
          `UPDATE admins SET deactivated_at = ${on ? 'NULL' : 'now()'} WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
          [target.id],
        )
        // A switched-off admin must not be able to come back in through
        // a link handed out earlier, or through a session token they
        // already hold.
        if (!on) {
          await client.query(
            `UPDATE admin_setup_links SET cancelled_at = now()
              WHERE admin_id = $1 AND used_at IS NULL AND cancelled_at IS NULL`,
            [target.id],
          )
          await resetSessions(client, target.id)
        }
        await recordActivity(client, {
          adminId: req.admin.id, action: on ? 'admin.switched_on' : 'admin.switched_off',
          targetType: 'admin', targetId: target.id,
          summary: `Switched ${target.name} ${on ? 'back on' : 'off'}`,
        })
        return updated[0]
      })
      res.json({ admin: adminPayload(row) })
    } catch (error) {
      sendRefusal(res, error)
    }
  }
}

router.post('/:id/switch-off', switchRoute(false))
router.post('/:id/switch-on', switchRoute(true))

/** Moves an admin to another facility. The owner belongs to no facility, so it can never be moved. */
router.post('/:id/move', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'No such admin' })
  try {
    const moved = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT ${ADMIN_COLUMNS} FROM admins WHERE id = $1 FOR UPDATE`, [req.params.id])
      const target = rows[0]
      if (!target) throw refusal(404, 'No such admin')
      if (target.role === 'owner') throw refusal(409, "The owner doesn't belong to a facility")

      const facility = isUuid(req.body?.facilityId) ? await findFacility(client.query.bind(client), req.body.facilityId) : null
      if (!facility) throw refusal(404, 'No such facility')
      if (target.facility_id === facility.id) throw refusal(409, 'Already in that facility')

      const { rows: updated } = await client.query(
        `UPDATE admins SET facility_id = $2 WHERE id = $1 RETURNING ${ADMIN_COLUMNS}`,
        [target.id, facility.id],
      )
      await recordActivity(client, {
        adminId: req.admin.id, action: 'admin.moved', targetType: 'admin', targetId: target.id,
        summary: `Moved admin ${target.name} to ${facility.name}`,
      })
      return updated[0]
    })
    res.json({ admin: adminPayload(moved) })
  } catch (error) {
    sendRefusal(res, error)
  }
})

export default router
