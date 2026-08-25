import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireAuth } from '../auth.js'
import { isUuid } from '../validate.js'

const router = Router()
router.use(requireAuth)

const SESSION_SELECT = `
  SELECT s.id,
         s.name,
         s.created_at,
         s.voided_at,
         s.void_reason,
         u.name AS created_by_name,
         (SELECT count(*)::int FROM session_players sp WHERE sp.session_id = s.id) AS player_count,
         (SELECT count(*)::int FROM matches m WHERE m.session_id = s.id)           AS match_count
    FROM sessions s
    LEFT JOIN umpires u ON u.id = s.created_by
`

router.get('/', async (_req, res) => {
  const { rows } = await query(`${SESSION_SELECT} ORDER BY s.created_at DESC`)
  res.json({ sessions: rows })
})

/**
 * Creates a session using an id minted by the device.
 *
 * Client-minted ids are what let the app work offline: it never has to
 * wait for the server to name anything, and a retry after an ambiguous
 * timeout is a no-op rather than a duplicate. Unlike players, sessions
 * have no semantic unique key, so two devices inventing ids
 * concurrently is harmless.
 *
 * `ON CONFLICT DO NOTHING` deliberately keeps the stored name on a
 * replay: this endpoint creates, it does not rename, and there is no
 * rename UI whose intent it could be mistaking.
 */
router.post('/', async (req, res) => {
  const id = String(req.body?.id ?? '')
  const name = String(req.body?.name ?? '').trim()

  if (!isUuid(id)) return res.status(400).json({ error: 'A valid session id is required' })
  if (!name) return res.status(400).json({ error: 'A session name is required' })
  if (name.length > 120) return res.status(400).json({ error: 'That name is too long' })

  await query(
    `INSERT INTO sessions (id, name, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, name, req.umpire.id],
  )

  const { rows } = await query(`${SESSION_SELECT} WHERE s.id = $1`, [id])
  res.status(201).json({ session: rows[0] })
})

/** One session plus its roster, with each player's stats for display. */
router.get('/:id', async (req, res) => {
  const { rows } = await query(`${SESSION_SELECT} WHERE s.id = $1`, [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'No such session' })

  const players = await query(
    `SELECT p.id, p.name
       FROM session_players sp
       JOIN players p ON p.id = sp.player_id
      WHERE sp.session_id = $1
      ORDER BY p.name`,
    [req.params.id],
  )

  res.json({
    session: { ...rows[0], playerIds: players.rows.map((p) => p.id) },
    players: players.rows,
  })
})

/**
 * Replaces a session's whole roster in one call.
 *
 * A full replace rather than add/remove endpoints, so it matches how
 * the outbox coalesces: several roster edits while offline collapse
 * into a single push carrying the final state, with no ordering
 * question between an add and a remove that were queued separately.
 *
 * Last writer wins if two devices edit the same roster. That is
 * acceptable here -- the loser can simply re-add -- and is noted as a
 * deliberate non-goal rather than an oversight.
 */
router.put('/:id/players', async (req, res) => {
  const playerIds = req.body?.playerIds

  if (!Array.isArray(playerIds)) {
    return res.status(400).json({ error: 'playerIds must be an array' })
  }
  if (!playerIds.every(isUuid)) {
    return res.status(400).json({ error: 'Every player id must be a valid id' })
  }

  const exists = await query('SELECT 1 FROM sessions WHERE id = $1', [req.params.id])
  if (exists.rowCount === 0) {
    return res.status(404).json({ error: 'No such session' })
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM session_players
          WHERE session_id = $1 AND player_id <> ALL ($2::uuid[])`,
        [req.params.id, playerIds],
      )
      if (playerIds.length > 0) {
        await client.query(
          `INSERT INTO session_players (session_id, player_id)
           SELECT $1, unnest($2::uuid[])
           ON CONFLICT DO NOTHING`,
          [req.params.id, playerIds],
        )
      }
    })
  } catch (error) {
    // 23503 = foreign_key_violation: a player id that isn't in the
    // registry. Reachable if a device references a player another
    // umpire deleted, so answer it clearly rather than as a 500.
    if (error.code === '23503') {
      return res.status(409).json({ error: 'One of those players no longer exists' })
    }
    throw error
  }

  const players = await query(
    `SELECT p.id, p.name
       FROM session_players sp
       JOIN players p ON p.id = sp.player_id
      WHERE sp.session_id = $1
      ORDER BY p.name`,
    [req.params.id],
  )
  res.json({ playerIds: players.rows.map((p) => p.id), players: players.rows })
})

/**
 * Cancels a session -- created by mistake, wrong night, wrong name.
 *
 * Unfinished matches inside it go too (nothing in them counted yet),
 * but a session holding a COMPLETED match is refused: that is real
 * recorded play, and cascading a delete through it would destroy data
 * the ML pipeline has already been given. Void those matches first if
 * they were genuinely wrong.
 *
 * Idempotent, so a delete queued offline and retried after someone else
 * removed the same session still settles as success rather than
 * dead-lettering.
 */
router.delete('/:id', async (req, res) => {
  const finished = await query(
    "SELECT count(*)::int AS n FROM matches WHERE session_id = $1 AND status = 'completed'",
    [req.params.id],
  )
  if (finished.rows[0].n > 0) {
    return res.status(409).json({
      error: `That session has ${finished.rows[0].n} finished match${
        finished.rows[0].n === 1 ? '' : 'es'
      } and can't be deleted. Void the session instead — that keeps the record but leaves it out of the exported data.`,
    })
  }

  // ON DELETE CASCADE clears session_players and any unfinished matches.
  await query('DELETE FROM sessions WHERE id = $1', [req.params.id])
  res.status(204).end()
})

/**
 * Voids (or restores) a whole session, excluding every match in it from
 * the ML export while keeping all the records.
 *
 * This is the answer for a session that cannot be deleted because real
 * play happened in it -- a duplicate night, the wrong court, a practice
 * run someone recorded in earnest. Deleting would destroy genuine
 * history; voiding just stops the pipeline being fed it.
 *
 * Deliberately does NOT touch the matches' own voided_at. Keeping the
 * two independent means restoring this session brings back only the
 * matches that were fine, and leaves any individually-voided ones
 * still excluded.
 */
router.post('/:id/void', async (req, res) => {
  const voided = req.body?.voided !== false
  const reason = String(req.body?.reason ?? '').trim() || null

  const { rows } = await query(
    `UPDATE sessions
        SET voided_at = CASE WHEN $2 THEN now() END,
            voided_by = CASE WHEN $2 THEN $3::uuid END,
            void_reason = CASE WHEN $2 THEN $4 END
      WHERE id = $1
      RETURNING id`,
    [req.params.id, voided, req.umpire.id, reason],
  )
  if (rows.length === 0) return res.status(404).json({ error: 'No such session' })

  const updated = await query(`${SESSION_SELECT} WHERE s.id = $1`, [req.params.id])
  res.json({ session: updated.rows[0] })
})

export default router
