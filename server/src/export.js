// ============================================================
// ML pipeline export
//
// Produces one row per player per completed match, in exactly the
// column shape aggregate_player_profiles() in the PaddlePad ML repo
// consumes (see data_generator.generate_unlabeled_match_logs there for
// the reference set this mirrors).
//
// This lives on the server rather than in the app because that is the
// entire point of phase 2: a device can only export the matches it
// recorded itself, so a per-device export can never give the pipeline
// the club's full data no matter how many matches get logged.
// ============================================================

import { deriveMatchState } from './pickleball.js'

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
]

export const RAW_MATCH_LOG_COLUMNS = [...ML_PIPELINE_COLUMNS, ...CONTEXT_COLUMNS]

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
 * time -- it needs the whole history in one pass. Fine at club scale;
 * noted rather than solved.
 */
export async function buildMatchLogRows(query) {
  const { rows: matches } = await query(
    `SELECT id, team_a, team_b, stacking_a, stacking_b,
            first_server_team, first_server_player,
            winner, started_at, ended_at
       FROM matches
      WHERE status = 'completed'
        AND ended_at IS NOT NULL
        -- Voided matches are excluded: a mis-paired match credits one
        -- player's rallies to another, and nothing downstream could
        -- detect that. Worse than having no match at all.
        AND voided_at IS NULL
      ORDER BY ended_at`,
  )
  if (matches.length === 0) return []

  const { rows: events } = await query(
    `SELECT e.match_id, e.seq, e.type, e.payload
       FROM match_events e
       JOIN matches m ON m.id = e.match_id
      WHERE m.status = 'completed' AND m.voided_at IS NULL
      ORDER BY e.match_id, e.seq`,
  )

  const eventsByMatch = new Map()
  for (const event of events) {
    if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, [])
    eventsByMatch.get(event.match_id).push({ type: event.type, ...event.payload })
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

/**
 * Escapes one CSV field per RFC 4180.
 *
 * Every column emitted today is a UUID, a number or an ISO timestamp,
 * so this is latent -- but a server-side export is exactly where
 * someone later adds `player_name`, and an unescaped comma in
 * "Cruz, John" would silently shift every following column by one with
 * nothing failing loudly.
 */
function escapeCsvField(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function matchLogsToCSV(rows) {
  const lines = [RAW_MATCH_LOG_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(RAW_MATCH_LOG_COLUMNS.map((col) => escapeCsvField(row[col])).join(','))
  }
  return lines.join('\n')
}
