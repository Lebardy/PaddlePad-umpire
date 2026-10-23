import { query } from './db.js'
import { bucketConfig, signedReadUrl } from './bucket.js'
import { highlightClips, rallySeconds } from './video-times.js'
import { pointRallyOrder } from './player-stats.js'

/**
 * A match's video for the point boxes, or null when it has none or
 * video is not set up here: a link good for two hours, and for each
 * POINT the second its rally starts at -- null for a point the video
 * does not show -- and the umpire's highlights as clips (start and end
 * seconds, and the point each one scored or null). `row` is the match, `events` its rows in play order
 * (with `at`), `log` the same events as the scoring engine reads them,
 * and whether this player may remove it: only the one who filmed it.
 */
export async function pointVideo(row, events, log, playerId) {
  const config = bucketConfig()
  if (!config) return null
  const { rows } = await query(
    `SELECT source, player_id, file_key, duration_ms, width, height, first_frame_at, highlights
       FROM match_videos WHERE match_id = $1 AND state = 'ready'`,
    [row.id],
  )
  const video = rows[0]
  if (!video) return null
  const timing = {
    startedAtMs: new Date(row.started_at).getTime(),
    offsetMs: row.clock_offset_ms,
    firstFrameAtMs: new Date(video.first_frame_at).getTime(),
    durationMs: video.duration_ms,
  }
  const timed = events.filter((e) => e.type === 'rally').map((e) => ({ id: e.id, atMs: new Date(e.at).getTime() }))
  const everyRally = rallySeconds({ ...timing, rallies: timed })
  // For each point, which rally scored it; a highlight that scored no point has no box to star.
  const order = pointRallyOrder(row, log)
  return {
    url: signedReadUrl(config, video.file_key),
    durationMs: video.duration_ms,
    width: video.width,
    height: video.height,
    mayRemove: video.source === 'player' && video.player_id === playerId,
    seconds: order.map((rally) => everyRally[rally] ?? null),
    highlights: highlightClips({ ...timing, rallies: timed, picked: video.highlights ?? [] })
      .map(({ index, start, end }) => ({ start, end, point: order.includes(index) ? order.indexOf(index) : null })),
  }
}
