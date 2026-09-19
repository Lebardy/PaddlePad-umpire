import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { recordActivity } from '../admin-activity.js'
import {
  facilityColumns, facilityFilterFor, facilityPayload, mayCreateFacility, mayManageFacility, readFacility,
} from '../facility-rules.js'
import { createFacility, facilityPeople, findFacility, listFacilities, updateFacility } from '../facility-store.js'
import { isUuid } from '../validate.js'

// Facilities: where umpires work. The owner sees and manages every one;
// a facility's own admins see and manage only theirs.
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

// The words a changed field is named by in an activity summary, keyed
// by the column readFacility produces -- so `Changed X for Y` always
// reads in plain words rather than database column names.
const FIELD_LABELS = {
  name: 'name',
  area: 'area',
  location_url: 'map link',
  opening_hours: 'opening hours',
  hourly_fee_centavos: 'fee',
  details: 'details',
}

router.get('/', async (req, res) => {
  const rows = await listFacilities(query, facilityFilterFor(req.admin, null))
  res.json({ facilities: rows.map(facilityPayload) })
})

router.post('/', async (req, res) => {
  if (!mayCreateFacility(req.admin)) return res.status(403).json({ error: 'Only the owner can do that' })
  const read = readFacility(req.body)
  if (read.error) return res.status(400).json({ error: read.error })
  try {
    const facility = await withTransaction(async (client) => {
      const created = await createFacility(client, read.values, req.admin.id)
      await recordActivity(client, {
        adminId: req.admin.id, action: 'facility.created', targetType: 'facility', targetId: created.id,
        summary: `Made facility ${created.name}`,
      })
      return created
    })
    res.status(201).json({ facility: facilityPayload(facility) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A facility with that name already exists' })
    throw error
  }
})

router.get('/:id', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  const facility = await findFacility(query, req.params.id)
  if (!facility) return res.status(404).json({ error: 'No such facility' })
  const { admins, umpires } = await facilityPeople(query, req.params.id)
  res.json({ facility: facilityPayload(facility), admins, umpires })
})

router.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  const read = readFacility(req.body, { partial: true })
  if (read.error) return res.status(400).json({ error: read.error })
  const columns = facilityColumns(read.values)
  if (columns.length === 0) return res.status(400).json({ error: 'Nothing to change' })

  try {
    const facility = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT id, name FROM facilities WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!rows[0]) throw refusal(404, 'No such facility')
      const before = rows[0]
      const updated = await updateFacility(client, req.params.id, read.values)
      // A rename gets its own wording, naming both the old and new name,
      // rather than "Changed name for <new name>" -- which would read as
      // though the facility already had the new name before the change.
      // It is only a rename if the name actually changed -- sending the
      // current name back (alongside other real edits) is not one.
      const isRename = columns.includes('name') && before.name !== updated.name
      const otherFields = columns.filter((column) => column !== 'name')
      const summary = isRename
        ? `Renamed facility ${before.name} to ${updated.name}` +
          (otherFields.length ? ` and changed ${otherFields.map((column) => FIELD_LABELS[column]).join(', ')}` : '')
        : `Changed ${columns.map((column) => FIELD_LABELS[column]).join(', ')} for ${updated.name}`
      await recordActivity(client, {
        adminId: req.admin.id, action: 'facility.updated', targetType: 'facility', targetId: updated.id,
        summary,
      })
      return updated
    })
    res.json({ facility: facilityPayload(facility) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A facility with that name already exists' })
    sendRefusal(res, error)
  }
})

export default router
