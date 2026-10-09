// ============================================================
// ML pipeline export
//
// Produces one row per player per completed match, in exactly the
// column shape aggregate_player_profiles() in the PaddlePad ML repo
// consumes (see data_generator.generate_unlabeled_match_logs there for
// the reference set this mirrors).
//
// This lives on the server rather than in the app because that is the
// entire point of phase 2: a device only ever holds the matches it
// recorded itself, so a per-device export could never give the
// pipeline the whole picture no matter how many matches get logged.
//
// These rows leave the server through GET /internal/match-logs.json
// and nowhere else. They cover every facility, which is why that route
// is behind the internal key rather than an umpire's token.
// ============================================================

import { deriveMatchState, eventFromRow } from './pickleball.js'
import { RALLY_ENDINGS, rallyEndingColumn } from './rally-endings.js'

// The 12 columns the ML pipeline actually reads today. Kept first and
// in this exact order so the CSV stays a drop-in superset of what the
// pipeline's own synthetic generator produces.
const ML_PIPELINE_COLUMNS = [
  'player_id',
  'match_id',
  'match_number',
  'drop_attempts',
  'drop_successes',
  'drive_attempts',
  'dink_errors',
  'clean_winners',
  'dink_winners',
  'unforced_errors',
  'match_duration_mins',
  'uses_stacking',
]

// Match context the pipeline does not read yet, recorded because it is
// already captured during play and costs the umpire nothing. Without
// it the pipeline can never do opponent-adjusted skill (so beating weak
// players cannot inflate a rating) or growth over time.
const CONTEXT_COLUMNS = [
  'team',
  'won',
  'partner_id',
  'opponent_1_id',
  'opponent_2_id',
  'ended_at',
  // What the game was played to (11, 15 or 21).
  //
  // Most pipeline features are ratios or per-minute rates and so are
  // largely robust to game length. The exception is the consistency
  // half of the feature set: a player whose matches mix formats will
  // show more spread in their per-match rates, and the pipeline reads
  // spread as INCONSISTENCY and marks them down for it -- even though
  // nothing about their play changed, only the format.
  //
  // Exporting it costs nothing and lets the pipeline control for it,
  // or filter to one format, rather than being unable to tell the
  // difference. Note the pklmart validation data is all games to 11.
  'point_target',
]

// How each of this player's rallies ended, one count per ending ("out
// of bounds", "kitchen fault"), from rally-endings.js. Last, so the
// CSV stays a drop-in superset of what the pipeline already reads.
//
// These are a finer split of the four buckets above, not extra rallies:
// the ended_ columns for winners add up to clean_winners + dink_winners
// only for matches scored after rallies started recording a detail.
// Older rallies have no detail, so for those every ended_ column is 0.
const RALLY_ENDING_COLUMNS = RALLY_ENDINGS.map((ending) => rallyEndingColumn(ending.key))

export const RAW_MATCH_LOG_COLUMNS = [
  ...ML_PIPELINE_COLUMNS,
  ...CONTEXT_COLUMNS,
  ...RALLY_ENDING_COLUMNS,
]

// Both timestamps come from device clocks, so one phone with a wrong
// clock would otherwise emit a nonsense duration straight into the
// per-minute rate features. Clamping bounds the damage; it cannot
// correct it, which is worth remembering when reading the data.
const MAX_PLAUSIBLE_MATCH_MINS = 240

/**
 * Builds every export row from the database.
 *
 * `match_number` means "this player's Nth completed match ever", which
 * is assigned by ordering ALL of a player's matches chronologically.
 * That is why this cannot be paginated or computed one match at a
 * time -- it needs the whole history in one pass. Fine at this scale;
 * noted rather than solved.
 */
export async function buildMatchLogRows(query) {
  const { rows: matches } = await query(
    `SELECT m.id, m.team_a, m.team_b, m.stacking_a, m.stacking_b,
            m.first_server_team, m.first_server_player, m.point_target,
            m.right_start_a, m.right_start_b,
            m.winner, m.started_at, m.ended_at
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.ended_at IS NOT NULL
        -- Voided matches are excluded: a mis-paired match credits one
        -- player's rallies to another, and nothing downstream could
        -- detect that. Worse than having no match at all.
        AND m.voided_at IS NULL
        -- A voided SESSION excludes everything in it, without marking
        -- the matches themselves. Keeping the two independent means
        -- restoring a session brings back only the matches that were
        -- fine, leaving individually-voided ones still out.
        AND s.voided_at IS NULL
      ORDER BY m.ended_at`,
  )
  if (matches.length === 0) return []

  const { rows: events } = await query(
    `SELECT e.match_id, e.id, e.seq, e.type, e.payload
       FROM match_events e
       JOIN matches m ON m.id = e.match_id
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
      ORDER BY e.match_id, e.seq`,
  )

  const eventsByMatch = new Map()
  for (const event of events) {
    if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, [])
    eventsByMatch.get(event.match_id).push(eventFromRow(event))
  }

  const rows = []

  for (const match of matches) {
    const derived = deriveMatchState({
      teamA: match.team_a,
      teamB: match.team_b,
      firstServer: {
        team: match.first_server_team,
        playerId: match.first_server_player,
      },
      rightStart: { A: match.right_start_a, B: match.right_start_b },
      pointTarget: match.point_target,
      events: eventsByMatch.get(match.id) ?? [],
    })

    const rawMins =
      (new Date(match.ended_at).getTime() - new Date(match.started_at).getTime()) / 60000
    const durationMins = Math.min(Math.max(rawMins, 0), MAX_PLAUSIBLE_MATCH_MINS)

    const seats = [
      ...match.team_a.map((playerId) => ({ playerId, team: 'A' })),
      ...match.team_b.map((playerId) => ({ playerId, team: 'B' })),
    ]

    for (const { playerId, team } of seats) {
      const stats = derived.stats[playerId]
      const ownTeam = team === 'A' ? match.team_a : match.team_b
      const opponents = team === 'A' ? match.team_b : match.team_a

      rows.push({
        player_id: playerId,
        match_id: match.id,
        drop_attempts: stats.drop_attempts,
        drop_successes: stats.drop_successes,
        drive_attempts: stats.drive_attempts,
        dink_errors: stats.dink_errors,
        clean_winners: stats.clean_winners,
        dink_winners: stats.dink_winners,
        unforced_errors: stats.unforced_errors,
        match_duration_mins: Math.round(durationMins * 100) / 100,
        uses_stacking: (team === 'A' ? match.stacking_a : match.stacking_b) ? 1 : 0,

        team,
        // Blank rather than 0 when a match was stopped at a tied score,
        // so "lost" and "no result" stay distinguishable.
        won: match.winner === null ? '' : match.winner === team ? 1 : 0,
        partner_id: ownTeam.find((id) => id !== playerId) ?? '',
        opponent_1_id: opponents[0] ?? '',
        opponent_2_id: opponents[1] ?? '',
        ended_at: new Date(match.ended_at).toISOString(),
        point_target: match.point_target,

        ...Object.fromEntries(
          RALLY_ENDINGS.map((ending) => [
            rallyEndingColumn(ending.key),
            derived.endings[playerId]?.[ending.key] ?? 0,
          ]),
        ),
      })
    }
  }

  // Assigned after every row exists, because it is a per-player running
  // count across the whole export, not a per-match value. `matches` is
  // already ordered by ended_at, so this is chronological.
  const countByPlayer = new Map()
  for (const row of rows) {
    const next = (countByPlayer.get(row.player_id) ?? 0) + 1
    countByPlayer.set(row.player_id, next)
    row.match_number = next
  }

  return rows
}
