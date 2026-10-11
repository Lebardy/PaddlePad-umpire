// ============================================================
// The daily clean-up of match videos.
//
// The bucket cannot delete old files by itself, so this does, once a
// day from inside the api:
//   1. videos that have been ready for more than KEEP_DAYS
//   2. videos still not ready a day after they were claimed
//   3. files in the bucket that no row names, once a day old
// Always the file first and the row second, so a failure part-way
// leaves a row that the next run finds again, never a file nobody knows.
// ============================================================

import { deleteFile, listFiles } from './bucket.js'

export const KEEP_DAYS = 60
const DAY_MS = 24 * 60 * 60 * 1000

/** The files nobody owns: named by no row, and more than a day old. */
export function orphanKeys(files, knownKeys, nowMs) {
  const known = new Set(knownKeys)
  return files.filter((file) => !known.has(file.key) && nowMs - file.modifiedMs > DAY_MS).map((file) => file.key)
}

export async function tidyVideos({ query, config, now = new Date() }) {
  const nowMs = now.getTime()
  const { rows } = await query(
    `SELECT match_id, file_key, state FROM match_videos
      WHERE (state = 'ready' AND ready_at < $1) OR (state <> 'ready' AND created_at < $2)`,
    [new Date(nowMs - KEEP_DAYS * DAY_MS), new Date(nowMs - DAY_MS)],
  )
  // One refused delete must not block the rest; its row stays for the next run.
  const gone = []
  for (const row of rows) {
    try {
      if (row.file_key) await deleteFile(config, row.file_key)
      await query('DELETE FROM match_videos WHERE match_id = $1', [row.match_id])
      gone.push(row)
    } catch (error) {
      console.error('video clean-up could not remove a video:', error.message)
    }
  }

  const { rows: kept } = await query('SELECT file_key FROM match_videos WHERE file_key IS NOT NULL')
  const orphans = orphanKeys(await listFiles(config, 'videos/'), kept.map((row) => row.file_key), nowMs)
  let orphansGone = 0
  for (const key of orphans) {
    try {
      await deleteFile(config, key)
      orphansGone += 1
    } catch (error) {
      console.error('video clean-up could not remove a file:', error.message)
    }
  }

  return {
    expired: gone.filter((row) => row.state === 'ready').length,
    unfinished: gone.filter((row) => row.state !== 'ready').length,
    orphans: orphansGone,
  }
}
