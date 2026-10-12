import { query } from './db.js'
import { bucketConfig, signedReadUrl } from './bucket.js'
import { rallySeconds } from './video-times.js'
import { pointRallyOrder } from './player-stats.js'

/**
 * A match's video for the point boxes, or null when it has none or
 * video is not set up here: a link good for two hours, and for each
 * POINT the second its rally starts at -- null for a point the video
 * does not show. `row` is the match, `events` its rows in play order
 * (with `at`), `log` the same events as the scoring engine reads them.
 */
export async function pointVideo(row, events, log) {
  const config = bucketConfig()
  if (!config) return null
  const { rows } = await query(
    `SELECT file_key, duration_ms, width, height, first_frame_at
       FROM match_videos WHERE match_id = $1 AND state = 'ready'`,
    [row.id],
  )
  const video = rows[0]
  if (!video) return null
  const everyRally = rallySeconds({
    startedAtMs: new Date(row.started_at).getTime(),
    offsetMs: row.clock_offset_ms,
    firstFrameAtMs: new Date(video.first_frame_at).getTime(),
    durationMs: video.duration_ms,
    rallies: events.filter((e) => e.type === 'rally').map((e) => ({ atMs: new Date(e.at).getTime() })),
  })
  return {
    url: signedReadUrl(config, video.file_key),
    durationMs: video.duration_ms,
    width: video.width,
    height: video.height,
    seconds: pointRallyOrder(row, log).map((rally) => everyRally[rally] ?? null),
  }
}
