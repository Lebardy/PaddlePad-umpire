// ============================================================
// Open play alerts: a rival or best partner joined an open play.
//
// A join queues one row per player whose block holds the joiner; a
// one-minute timer sends what is due. The words are written at send
// time, so an alert held overnight carries the morning's count.
// ============================================================

import webpush from 'web-push'
import { getRallyRatings } from './rally-rating-store.js'
import { DAILY_CAP, alertTitle, pushGone, sendAfter } from './rivals.js'
import { blocksFor, counterparts, ratingNeighbours } from './rivals-store.js'
import { manilaDayStart, openPlayWhen } from './visit-rules.js'

/** The push keys, or null when any is missing: then nothing is queued and the bell is hidden. */
export function pushConfig() {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}

export async function saveSubscription(query, playerId, { endpoint, keys }) {
  // A phone handed to another player moves with its endpoint.
  await query(
    `INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET player_id = $2, p256dh = $3, auth = $4`,
    [endpoint, playerId, keys.p256dh, keys.auth],
  )
}

export async function removeSubscription(query, playerId, endpoint) {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND player_id = $2', [endpoint, playerId])
}

/** Who has `joinerId` in their block, has a phone to tell, and is not going: queued (or re-armed for a quiet update). */
export async function queueAlerts(query, openPlayId, joinerId, now) {
  if (!pushConfig()) return 0
  const ratings = await getRallyRatings(query)
  const candidates = [...new Set([...(await counterparts(query, joinerId)), ...ratingNeighbours(ratings, joinerId)])]
  if (candidates.length === 0) return 0
  const { rows: reachable } = await query(
    `SELECT DISTINCT s.player_id FROM push_subscriptions s
      WHERE s.player_id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM open_play_joins j WHERE j.open_play_id = $2 AND j.player_id = s.player_id)`,
    [candidates, openPlayId],
  )
  if (reachable.length === 0) return 0
  const blocks = await blocksFor(query, reachable.map((r) => r.player_id))
  const receivers = [...blocks]
    .filter(([, block]) => [...block.rivals, ...block.partners].some((p) => p.id === joinerId))
    .map(([id]) => id)
  if (receivers.length === 0) return 0
  // A sent alert is re-armed: the next send replaces it on the phone without a buzz.
  const { rowCount } = await query(
    `INSERT INTO open_play_alerts (player_id, open_play_id, state, send_after)
     SELECT unnest($1::uuid[]), $2, 'waiting', $3
     ON CONFLICT (player_id, open_play_id) DO UPDATE SET state = 'waiting', send_after = $3
       WHERE open_play_alerts.state = 'sent'`,
    [receivers, openPlayId, sendAfter(now)],
  )
  return rowCount
}

/** Sends every alert that is due. Never throws for one phone: a failed push is counted and the row is done. */
export async function sendDueAlerts(query, now) {
  const config = pushConfig()
  const counts = { sent: 0, skipped: 0, gone: 0, failed: 0 }
  if (!config) return counts
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  const { rows: due } = await query(
    `SELECT a.player_id, a.open_play_id, a.first_sent_at, o.starts_at, o.ends_at, o.facility_id, f.name AS facility_name,
            COALESCE(array_agg(j.player_id) FILTER (WHERE j.player_id IS NOT NULL), '{}') AS going
       FROM open_play_alerts a
       JOIN open_plays o ON o.id = a.open_play_id
       JOIN facilities f ON f.id = o.facility_id
       LEFT JOIN open_play_joins j ON j.open_play_id = o.id
      WHERE a.state = 'waiting' AND a.send_after <= $1
      GROUP BY a.player_id, a.open_play_id, a.first_sent_at, o.id, f.name`,
    [now],
  )
  if (due.length === 0) return counts
  const blocks = await blocksFor(query, [...new Set(due.map((d) => d.player_id))])
  const finish = (row, state, firstSentAt = row.first_sent_at) => query(
    'UPDATE open_play_alerts SET state = $3, first_sent_at = $4 WHERE player_id = $1 AND open_play_id = $2',
    [row.player_id, row.open_play_id, state, firstSentAt],
  )
  for (const row of due) {
    const block = blocks.get(row.player_id)
    const going = [
      ...block.rivals.filter((r) => row.going.includes(r.id)).map((r) => ({ kind: 'rival', name: r.name })),
      ...block.partners.filter((p) => row.going.includes(p.id)).map((p) => ({ kind: 'partner', name: p.name })),
    ]
    const title = alertTitle(going)
    const first = row.first_sent_at === null
    const tooLate = new Date(row.starts_at) <= now || row.going.includes(row.player_id) || !title
    const { rows: [{ today }] } = first
      ? await query('SELECT count(*)::int AS today FROM open_play_alerts WHERE player_id = $1 AND first_sent_at >= $2', [row.player_id, manilaDayStart(now)])
      : { rows: [{ today: 0 }] }
    if (tooLate || (first && today >= DAILY_CAP)) {
      counts.skipped += 1
      await finish(row, first ? 'skipped' : 'sent')
      continue
    }
    const payload = JSON.stringify({
      title,
      body: `${openPlayWhen(row.starts_at, row.ends_at)} · ${row.facility_name}`,
      tag: row.open_play_id,
      url: `/places/${row.facility_id}`,
      update: !first,
    })
    const { rows: phones } = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE player_id = $1', [row.player_id])
    for (const phone of phones) {
      try {
        await webpush.sendNotification({ endpoint: phone.endpoint, keys: { p256dh: phone.p256dh, auth: phone.auth } }, payload, { TTL: 6 * 60 * 60 })
        counts.sent += 1
      } catch (error) {
        if (pushGone(error.statusCode)) {
          counts.gone += 1
          await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [phone.endpoint])
        } else counts.failed += 1
      }
    }
    await finish(row, 'sent', row.first_sent_at ?? now)
  }
  return counts
}
