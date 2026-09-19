import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAdminAccount, requireOwner } from '../auth.js'
import { recordActivity } from '../admin-activity.js'
import { generateInviteCode } from '../invites.js'
import { wipePlayerCredentials } from '../player-accounts.js'
import {
  closedUmpireEmail, confirmNameMatches, mayClose, mayMintClaimCode, readPauseReason, readStatusFilter,
} from '../people-rules.js'
import {
  findPlayerRow, findUmpireRow, listPlayers, listUmpires, playerDetail, umpireDetail,
} from '../people-store.js'
import { facilityFilterFor, mayManageUmpire, mayPausePlayers } from '../facility-rules.js'
import { findFacility } from '../facility-store.js'
import { isUuid } from '../validate.js'

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

const noGuard = () => null

/**
 * Pause, unpause and close are the same shape for players and umpires;
 * `kind` holds what differs.
 *
 * `kind.readGuard(admin, row)` and `kind.pauseGuard(admin, row)` each
 * return null to allow, or `{ statusCode, message }` to refuse -- used
 * so an umpire outside a facility admin's own facility answers 404
 * ("No such umpire") on every read and pause/unpause. Both need the
 * row (facility scoping), so they run once it has been looked up.
 *
 * `kind.pauseRoleGuard(admin)` is a SEPARATE, row-independent check --
 * used so pausing a player is the owner's alone. It runs before any
 * database access at all, so a non-owner always gets the same 403
 * regardless of whether the id they sent even exists: checking a
 * role-only rule after a row lookup would let the 404-vs-403 split
 * leak which ids are real.
 */
function peopleRouter(kind) {
  const router = Router()
  router.use(requireAdminAccount(query))

  const notFound = `No such ${kind.noun}`
  const closedColumn = kind.closedColumn
  const readGuard = kind.readGuard ?? noGuard
  const pauseGuard = kind.pauseGuard ?? noGuard
  const pauseRoleGuard = kind.pauseRoleGuard ?? noGuard

  router.get('/', async (req, res) => {
    const options = { status: readStatusFilter(req.query.status), q: req.query.q, after: req.query.after }
    if (kind.facilityFilter) options.facilityFilter = kind.facilityFilter(req.admin, req.query.facilityId)
    const page = await kind.list(query, options)
    res.json({ [kind.plural]: page.items, next: page.next })
  })

  router.get('/:id', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: notFound })
    const row = await kind.find(query, req.params.id)
    if (!row) return res.status(404).json({ error: notFound })
    const refused = readGuard(req.admin, row)
    if (refused) return res.status(refused.statusCode).json({ error: refused.message })
    res.json({ [kind.noun]: await kind.detail(query, row) })
  })

  /** Runs one change and its activity entry together, then answers with the fresh page data. */
  async function change(req, res, apply, { guard } = {}) {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: notFound })
    try {
      await withTransaction(async (client) => {
        // kind.find expects a callable queryFn(text, params), the same
        // shape as the module-level `query` -- a raw pg client is not
        // itself callable, only its .query method is.
        const row = await kind.find(client.query.bind(client), req.params.id, { lock: true })
        if (!row) throw refusal(404, notFound)
        if (guard) {
          const refused = guard(req.admin, row)
          if (refused) throw refusal(refused.statusCode, refused.message)
        }
        await apply(client, row)
      })
      const fresh = await kind.find(query, req.params.id)
      res.json({ [kind.noun]: await kind.detail(query, fresh) })
    } catch (error) {
      sendRefusal(res, error)
    }
  }

  router.post('/:id/pause', async (req, res) => {
    const early = pauseRoleGuard(req.admin)
    if (early) return res.status(early.statusCode).json({ error: early.message })
    const { reason, error } = readPauseReason(req.body?.reason)
    if (error) return res.status(400).json({ error })
    await change(req, res, async (client, row) => {
      if (row[closedColumn]) throw refusal(409, 'This account is closed')
      if (row.paused_at) throw refusal(409, 'Already paused')
      await client.query(`UPDATE ${kind.table} SET paused_at = now(), paused_reason = $2 WHERE id = $1`, [row.id, reason])
      await recordActivity(client, {
        adminId: req.admin.id, action: `${kind.noun}.paused`, targetType: kind.noun, targetId: row.id,
        summary: `Paused ${kind.noun} ${row.name}: ${reason}`,
      })
    }, { guard: pauseGuard })
  })

  router.post('/:id/unpause', async (req, res) => {
    const early = pauseRoleGuard(req.admin)
    if (early) return res.status(early.statusCode).json({ error: early.message })
    await change(req, res, async (client, row) => {
      if (row[closedColumn] || !row.paused_at) throw refusal(409, "This account isn't paused")
      await client.query(`UPDATE ${kind.table} SET paused_at = NULL, paused_reason = NULL WHERE id = $1`, [row.id])
      await recordActivity(client, {
        adminId: req.admin.id, action: `${kind.noun}.unpaused`, targetType: kind.noun, targetId: row.id,
        summary: `Switched ${kind.noun} ${row.name} back on`,
      })
    }, { guard: pauseGuard })
  })

  router.post('/:id/close', async (req, res) => {
    if (!mayClose(req.admin)) return res.status(403).json({ error: 'Only the owner can close accounts' })
    const { reason, error } = readPauseReason(req.body?.reason)
    if (error) return res.status(400).json({ error })
    await change(req, res, async (client, row) => {
      if (row[closedColumn]) throw refusal(409, 'This account is already closed')
      if (!confirmNameMatches(req.body?.confirmName, row.name)) throw refusal(400, 'Type their name exactly to confirm')
      await kind.close(client, row)
      await recordActivity(client, {
        adminId: req.admin.id, action: `${kind.noun}.closed`, targetType: kind.noun, targetId: row.id,
        summary: `Closed ${kind.noun} ${row.name}${kind.noun === 'umpire' ? ` (${row.email})` : ''} for good: ${reason}`,
      })
    })
  })

  return router
}

export const adminPlayersRoutes = peopleRouter({
  noun: 'player', plural: 'players', table: 'players', closedColumn: 'deactivated_at',
  list: listPlayers, find: findPlayerRow, detail: playerDetail,
  // Players belong to no facility -- pausing one affects them everywhere,
  // so it stays the owner's alone rather than being scoped by facility.
  // Row-independent, so it is checked before any lookup (see
  // peopleRouter's doc comment on pauseRoleGuard).
  pauseRoleGuard: (admin) => (mayPausePlayers(admin) ? null : { statusCode: 403, message: 'Only the owner can pause players' }),
  // Shares the wipe with DELETE /player/me, then stamps that THIS close
  // came from the admin site -- self-deletion never sets this column,
  // which is what makes reopening an owner's close the owner's alone.
  close: async (client, row) => {
    await wipePlayerCredentials(client, row.id)
    await client.query('UPDATE players SET closed_by_admin_at = now() WHERE id = $1', [row.id])
  },
})

/** The owner may filter the umpire list by a facility; a facility admin is always pinned to their own. */
function umpireFacilityFilter(admin, queryFacilityId) {
  return facilityFilterFor(admin, isUuid(queryFacilityId) ? queryFacilityId : null)
}

const umpireOutsideFacility = { statusCode: 404, message: 'No such umpire' }
const umpireFacilityGuard = (admin, row) => (mayManageUmpire(admin, row) ? null : umpireOutsideFacility)

export const adminUmpiresRoutes = peopleRouter({
  noun: 'umpire', plural: 'umpires', table: 'umpires', closedColumn: 'closed_at',
  list: listUmpires, find: findUmpireRow, detail: umpireDetail,
  facilityFilter: umpireFacilityFilter,
  readGuard: umpireFacilityGuard,
  pauseGuard: umpireFacilityGuard,
  close: (client, row) => client.query(
    `UPDATE umpires
        SET password_hash = NULL, google_sub = NULL, google_email = NULL,
            email = $2, paused_at = NULL, paused_reason = NULL, closed_at = now()
      WHERE id = $1`,
    [row.id, closedUmpireEmail(row.id)],
  ),
})

// A new claim code replaces the old one, so a lost or leaked code stops
// working. Shown to the admin once; never included in any list.
adminPlayersRoutes.post('/:id/claim-code', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'No such player' })
  try {
    const claimCode = await withTransaction(async (client) => {
      const row = await findPlayerRow(client.query.bind(client), req.params.id, { lock: true })
      if (!row) throw refusal(404, 'No such player')
      if (!mayMintClaimCode(row, { isOwner: mayClose(req.admin) })) {
        throw refusal(403, 'Only the owner can reopen a closed account')
      }
      if (row.paused_at && !row.deactivated_at) throw refusal(409, 'Switch this player back on before making a new code')
      const code = generateInviteCode()
      await client.query('UPDATE players SET claim_code = $2 WHERE id = $1', [row.id, code])
      await recordActivity(client, {
        adminId: req.admin.id, action: 'player.claim_code_created', targetType: 'player', targetId: row.id,
        summary: `Made a new claim code for ${row.name}`,
      })
      return code
    })
    res.json({ claimCode })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That code clashed with another. Try again.' })
    sendRefusal(res, error)
  }
})

// Moving an umpire to another facility is the owner's alone.
adminUmpiresRoutes.post('/:id/move', requireOwner, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'No such umpire' })
  try {
    const movedId = await withTransaction(async (client) => {
      const row = await findUmpireRow(client.query.bind(client), req.params.id, { lock: true })
      if (!row) throw refusal(404, 'No such umpire')

      const facility = isUuid(req.body?.facilityId) ? await findFacility(client.query.bind(client), req.body.facilityId) : null
      if (!facility) throw refusal(404, 'No such facility')
      if (row.facility_id === facility.id) throw refusal(409, 'Already in that facility')

      await client.query('UPDATE umpires SET facility_id = $2 WHERE id = $1', [row.id, facility.id])
      await recordActivity(client, {
        adminId: req.admin.id, action: 'umpire.moved', targetType: 'umpire', targetId: row.id,
        summary: `Moved umpire ${row.name} to ${facility.name}`,
      })
      return row.id
    })
    const fresh = await findUmpireRow(query, movedId)
    res.json({ umpire: await umpireDetail(query, fresh) })
  } catch (error) {
    sendRefusal(res, error)
  }
})
