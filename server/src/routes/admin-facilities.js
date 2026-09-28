import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount } from '../auth.js'
import { recordActivity } from '../admin-activity.js'
import {
  changedFacilityColumns, facilityColumns, facilityFilterFor, facilityPayload, mayCreateFacility, mayManageFacility,
  readFacility, readLogoUpload,
} from '../facility-rules.js'
import {
  createFacility, facilityPeople, facilityPeopleCounts, findFacility, listFacilities, lockFacility, removeFacilityLogo,
  saveFacilityLogo, updateFacility,
} from '../facility-store.js'
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
  hourly_fee_centavos: 'court fee',
  umpire_fee_centavos: 'umpire fee',
  details: 'details',
}

router.get('/', async (req, res) => {
  const rows = await listFacilities(query, facilityFilterFor(req.admin, null))
  // The counts ride along so the owner's table needs no request per
  // facility (one each used to run a busy owner into the rate limit).
  const counts = await facilityPeopleCounts(query, rows.map((row) => row.id))
  res.json({
    facilities: rows.map((row) => ({
      ...facilityPayload(row),
      umpireCount: counts.get(row.id).umpires,
      adminCount: counts.get(row.id).admins,
    })),
  })
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
      const before = await lockFacility(client, req.params.id)
      if (!before) throw refusal(404, 'No such facility')

      // Only the fields the edit actually changes get written and
      // recorded -- the edit form sends every field on every save (so a
      // cleared field reaches the server), so `columns` alone would
      // credit a save with changing fields it only resent unchanged,
      // and a save that changes nothing would still write an entry.
      const changed = changedFacilityColumns(before, read.values)
      if (changed.length === 0) return before

      const updated = await updateFacility(client, req.params.id, read.values)
      // A rename gets its own wording, naming both the old and new name,
      // rather than "Changed name for <new name>" -- which would read as
      // though the facility already had the new name before the change.
      const isRename = changed.includes('name')
      const otherFields = changed.filter((column) => column !== 'name')
      const summary = isRename
        ? `Renamed facility ${before.name} to ${updated.name}` +
          (otherFields.length ? ` and changed ${otherFields.map((column) => FIELD_LABELS[column]).join(', ')}` : '')
        : `Changed ${changed.map((column) => FIELD_LABELS[column]).join(', ')} for ${updated.name}`
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

/**
 * A facility's logo: the same admins who may edit its details may
 * change it. The picture was shrunk in the browser; readLogoUpload
 * checks it again here. The facility row is locked so a rename in
 * flight can't leave the activity entry naming the old name.
 */
router.put('/:id/logo', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  const read = readLogoUpload(req.body)
  if (read.error) return res.status(400).json({ error: read.error })
  try {
    const facility = await withTransaction(async (client) => {
      const before = await lockFacility(client, req.params.id)
      if (!before) throw refusal(404, 'No such facility')
      await saveFacilityLogo(client, before.id, read.values, req.admin.id)
      await recordActivity(client, {
        adminId: req.admin.id, action: 'facility.logo_changed', targetType: 'facility', targetId: before.id,
        summary: `Changed the logo for ${before.name}`, facilityId: before.id,
      })
      return findFacility((sql, params) => client.query(sql, params), before.id)
    })
    res.json({ facility: facilityPayload(facility) })
  } catch (error) {
    sendRefusal(res, error)
  }
})

router.delete('/:id/logo', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  try {
    const facility = await withTransaction(async (client) => {
      const before = await lockFacility(client, req.params.id)
      if (!before) throw refusal(404, 'No such facility')
      // Removing a logo that is already gone changes nothing, so it
      // writes no activity entry either.
      if (await removeFacilityLogo(client, before.id)) {
        await recordActivity(client, {
          adminId: req.admin.id, action: 'facility.logo_removed', targetType: 'facility', targetId: before.id,
          summary: `Removed the logo for ${before.name}`, facilityId: before.id,
        })
      }
      return findFacility((sql, params) => client.query(sql, params), before.id)
    })
    res.json({ facility: facilityPayload(facility) })
  } catch (error) {
    sendRefusal(res, error)
  }
})

export default router
