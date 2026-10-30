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
import { levelLookup, loadCourtState, loadFacilityUmpires, loadOpenPlays, recentRatings } from '../open-play-store.js'
import { guestsTotals, openPlayRow, openPlayWhen, readOpenPlay, visitSummary } from '../visit-rules.js'

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
  films_matches: 'match filming',
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

/**
 * A place's Guests page: this week's open plays with who's coming by level
 * (never by name), and how visits went over the last 30 days, anonymous.
 */
router.get('/:id/guests', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  const [plays, { levelOf, levelsShown }, ratings, umpires] = await Promise.all([
    loadOpenPlays(query, { facilityId: req.params.id, now: new Date() }),
    levelLookup(query),
    recentRatings(query, req.params.id),
    loadFacilityUmpires(query, req.params.id),
  ])
  const courtState = await loadCourtState(query, plays.map((p) => p.id))
  res.json({
    totals: guestsTotals(plays),
    umpires,
    openPlays: plays.map((play) => {
      const { facility, atYourLevel, names, you, ...row } = openPlayRow(play, { joined: play.joined, levelOf, levelsShown })
      return {
        ...row,
        status: row.count >= row.spots ? 'full' : 'open',
        // Only a play with an umpire has courts to hand out.
        courtRoster: play.umpire
          ? Array.from({ length: play.courts }, (_, i) => {
              const slot = courtState.get(play.id).get(i + 1)
              return { court: i + 1, umpire: slot?.assignee ?? null, session: slot?.session ?? null }
            })
          : null,
      }
    }),
    visits: visitSummary(ratings),
  })
})

router.post('/:id/open-plays', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  const read = readOpenPlay(req.body, new Date())
  if (read.error) return res.status(400).json({ error: read.error })
  const { startsAt, endsAt, courts, spots, feeCentavos, umpire, note } = read.values
  try {
    const openPlay = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO open_plays (facility_id, starts_at, ends_at, courts, spots, fee_centavos, umpire, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [req.params.id, startsAt, endsAt, courts, spots, feeCentavos, umpire, note, req.admin.id],
      )
      await recordActivity(client, {
        adminId: req.admin.id, action: 'open_play.added', targetType: 'facility', targetId: req.params.id,
        facilityId: req.params.id, summary: `Added open play ${openPlayWhen(startsAt, endsAt)}`,
      })
      return { id: rows[0].id, ...read.values }
    })
    res.status(201).json({ openPlay })
  } catch (error) {
    // The owner may name any id; one that is no facility fails its foreign key.
    if (error.code === '23503') return res.status(404).json({ error: 'No such facility' })
    throw error
  }
})

/** Cancelling deletes the open play and everyone's join to it. */
router.delete('/:id/open-plays/:openPlayId', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  if (!isUuid(req.params.openPlayId)) return res.status(404).json({ error: 'No such open play' })
  try {
    const cancelled = await withTransaction(async (client) => {
      const { rows: [{ going }] } = await client.query(
        // Counted as the page counts them: paused or closed players are not going.
        `SELECT count(*)::int AS going FROM open_play_joins j JOIN players p ON p.id = j.player_id
          WHERE j.open_play_id = $1 AND p.deactivated_at IS NULL AND p.paused_at IS NULL`,
        [req.params.openPlayId],
      )
      // Deleting would orphan the sessions' link to it, so once a court has started it stays.
      const { rows: [started] } = await client.query(
        'SELECT 1 FROM sessions WHERE open_play_id = $1 AND court IS NOT NULL AND voided_at IS NULL LIMIT 1',
        [req.params.openPlayId],
      )
      if (started) throw refusal(409, 'Courts already started')
      const { rows } = await client.query(
        'DELETE FROM open_plays WHERE id = $1 AND facility_id = $2 RETURNING starts_at, ends_at',
        [req.params.openPlayId, req.params.id],
      )
      if (!rows[0]) return false
      await recordActivity(client, {
        adminId: req.admin.id, action: 'open_play.cancelled', targetType: 'facility', targetId: req.params.id,
        facilityId: req.params.id,
        summary: `Cancelled open play ${openPlayWhen(rows[0].starts_at, rows[0].ends_at)} (${going} ${going === 1 ? 'player was' : 'players were'} going)`,
      })
      return true
    })
    if (!cancelled) return res.status(404).json({ error: 'No such open play' })
    res.status(204).end()
  } catch (error) {
    sendRefusal(res, error)
  }
})

/** Puts an umpire on one court of an open play, or leaves it open to anyone (umpireId null). */
router.put('/:id/open-plays/:openPlayId/courts/:court', async (req, res) => {
  if (!isUuid(req.params.id) || !mayManageFacility(req.admin, req.params.id)) {
    return res.status(404).json({ error: 'No such facility' })
  }
  if (!isUuid(req.params.openPlayId)) return res.status(404).json({ error: 'No such open play' })
  const court = Number(req.params.court)
  const umpireId = req.body?.umpireId ?? null
  if (umpireId !== null && !isUuid(umpireId)) return res.status(400).json({ error: 'Pick an umpire' })
  try {
    const result = await withTransaction(async (client) => {
      const q = client.query.bind(client)
      const { rows: [play] } = await q(
        'SELECT id, starts_at, ends_at, courts, umpire FROM open_plays WHERE id = $1 AND facility_id = $2 FOR UPDATE',
        [req.params.openPlayId, req.params.id],
      )
      if (!play) throw refusal(404, 'No such open play')
      if (!Number.isInteger(court) || court < 1 || court > play.courts) throw refusal(404, 'No such court')
      if (!play.umpire) throw refusal(409, 'This open play has no umpire')
      let umpire = null
      if (umpireId) {
        const { rows: [found] } = await q(
          'SELECT id, name FROM umpires WHERE id = $1 AND facility_id = $2 AND paused_at IS NULL AND closed_at IS NULL',
          [umpireId, req.params.id],
        )
        if (!found) throw refusal(400, 'Pick an umpire from this place')
        const { rows: [elsewhere] } = await q(
          'SELECT court FROM open_play_courts WHERE open_play_id = $1 AND umpire_id = $2 AND court <> $3',
          [play.id, umpireId, court],
        )
        if (elsewhere) throw refusal(409, `${found.name} is on Court ${elsewhere.court}`)
        await q(
          `INSERT INTO open_play_courts (open_play_id, court, umpire_id, assigned_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (open_play_id, court) DO UPDATE SET umpire_id = EXCLUDED.umpire_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
          [play.id, court, umpireId, req.admin.id],
        )
        umpire = { id: found.id, name: found.name, active: true }
      } else {
        await q('DELETE FROM open_play_courts WHERE open_play_id = $1 AND court = $2', [play.id, court])
      }
      const when = openPlayWhen(play.starts_at, play.ends_at)
      await recordActivity(client, {
        adminId: req.admin.id, action: 'open_play.court_assigned', targetType: 'facility', targetId: req.params.id,
        facilityId: req.params.id,
        summary: umpire ? `Assigned ${umpire.name} to Court ${court} · ${when}` : `Court ${court} left open to anyone · ${when}`,
      })
      return { court, umpire }
    })
    res.json({ court: result })
  } catch (error) {
    sendRefusal(res, error)
  }
})

export default router
