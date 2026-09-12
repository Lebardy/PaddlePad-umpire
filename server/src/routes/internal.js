// ============================================================
// Service-to-service routes for the ML pipeline
//
// The Python service that computes skill scores talks to the API
// through these two endpoints and never touches the database.
//
// That is not squeamishness about giving it a DATABASE_URL -- it is
// forced by where the data lives. The per-player shot counts the
// pipeline consumes (drop_successes, dink_winners, ...) do not exist as
// columns anywhere. They are DERIVED by replaying the append-only tap
// log through deriveMatchState in src/pickleball.js. A Python service
// reading tables directly would have to reimplement side-out pickleball
// scoring to get them, and a second implementation of the scoring
// engine is the last thing this project needs. Going through the API
// keeps one engine, and keeps the voided-match and voided-session
// filters in one place.
// ============================================================

import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireInternalKey } from '../auth.js'
import { buildMatchLogRows } from '../export.js'
import { RATING_GATE } from '../rating-gate.js'

const router = Router()
router.use(requireInternalKey)

/**
 * Every completed, non-voided match row, in the shape
 * aggregate_player_profiles() consumes.
 *
 * Identical rows to GET /export/match-logs.json, which stays as it is
 * for the umpire-facing download. Shared through buildMatchLogRows
 * rather than by loosening the guard on that route.
 */
router.get('/match-logs.json', async (_req, res) => {
  const rows = await buildMatchLogRows(query)
  // The gate thresholds ride along with the data so the Python side
  // applies the same numbers the player app counts progress against,
  // rather than keeping its own copy that can drift out of step.
  res.json({ rows, count: rows.length, gate: RATING_GATE })
})

/**
 * Records one pipeline run as a snapshot.
 *
 * The whole run arrives in one body and is written in one transaction,
 * so a snapshot is either complete or absent. A partially-written
 * snapshot would be indistinguishable from a real one that happened to
 * be missing players, which is exactly the failure this design exists
 * to prevent.
 */
router.post('/ratings', async (req, res) => {
  const {
    status = 'completed',
    pipelineVersion = null,
    playerCount = 0,
    matchCount = 0,
    notes = {},
    ratings = [],
  } = req.body ?? {}

  if (status !== 'completed' && status !== 'failed') {
    return res.status(400).json({ error: 'status must be "completed" or "failed"' })
  }

  // A failed run is recorded deliberately: it is how "the pipeline ran
  // and refused to publish" stays distinguishable from "the pipeline
  // never ran", which is the difference between a bug and a silence.
  if (status === 'failed') {
    const { rows } = await query(
      `INSERT INTO rating_runs (status, player_count, match_count, pipeline_version, notes)
       VALUES ('failed', $1, $2, $3, $4) RETURNING id, computed_at`,
      [playerCount, matchCount, pipelineVersion, notes],
    )
    return res.status(201).json({ run: rows[0], written: 0 })
  }

  if (!Array.isArray(ratings) || ratings.length === 0) {
    return res
      .status(400)
      .json({ error: 'A completed run must carry at least one rating' })
  }

  const ids = ratings.map((r) => r.playerId)
  if (ids.some((id) => typeof id !== 'string' || !id)) {
    return res.status(400).json({ error: 'Every rating needs a playerId' })
  }
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'Duplicate playerId in ratings' })
  }

  // Checked up front rather than left to the foreign key, so an unknown
  // player produces one clear message naming it instead of a generic
  // constraint violation on a rolled-back transaction.
  const { rows: known } = await query(
    'SELECT id FROM players WHERE id = ANY($1::uuid[])',
    [ids],
  )
  if (known.length !== ids.length) {
    const found = new Set(known.map((r) => r.id))
    const missing = ids.filter((id) => !found.has(id))
    return res.status(400).json({
      error: 'Ratings reference players that do not exist',
      missing: missing.slice(0, 10),
    })
  }

  const run = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO rating_runs (status, player_count, match_count, pipeline_version, notes)
       VALUES ('completed', $1, $2, $3, $4) RETURNING id, computed_at`,
      [playerCount, matchCount, pipelineVersion, notes],
    )
    const runId = rows[0].id

    // One multi-row insert rather than a loop: club-scale runs are a few
    // dozen players, well inside Postgres' parameter limit, and it keeps
    // the whole snapshot to a single round trip.
    const values = []
    const params = []
    for (const r of ratings) {
      const base = params.length
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`,
      )
      params.push(
        runId,
        r.playerId,
        r.skillScore,
        r.skillTier ?? null,
        r.skillGroup ?? null,
        r.playstyleCluster ?? null,
        r.playstyleArchetype ?? null,
        r.evidence ?? {},
        r.matchCount ?? 0,
        // The words behind the archetype and the measurement each came
        // from. Null where the pipeline sent none -- an older pipeline,
        // or a group too small to have an archetype at all.
        Array.isArray(r.playstyleTraits) ? JSON.stringify(r.playstyleTraits) : null,
        // The four parts the score is a sum of. Null from an older
        // pipeline, which the app treats as "not recorded for this run"
        // rather than as a rating with nothing behind it.
        r.scoreParts && typeof r.scoreParts === 'object'
          ? JSON.stringify(r.scoreParts)
          : null,
      )
    }

    await client.query(
      `INSERT INTO player_ratings
         (run_id, player_id, skill_score, skill_tier, skill_group,
          playstyle_cluster, playstyle_archetype, evidence, match_count,
          playstyle_traits, score_parts)
       VALUES ${values.join(', ')}`,
      params,
    )

    return rows[0]
  })

  res.status(201).json({ run, written: ratings.length })
})

export default router
