// ============================================================
// Rivals and best partners, and the words of an open play alert.
// Pure: the store passes everything in.
// ============================================================

import { manilaDayStart, manilaHour } from './visit-rules.js'

export const RATING_GAP = 25  // the weaker side still wins about 3 games in 10
export const SHOWN = 3
export const DAILY_CAP = 3

const HOUR = 60 * 60 * 1000

/**
 * One player's block: up to SHOWN rivals and SHOWN partners. `people`
 * holds only active players, so anyone closed or paused drops out here.
 */
export function blockFor({ me, matches, ratings, people, minMatches }) {
  const against = new Map()   // id -> { won, lost }
  const together = new Map()  // id -> { wins, losses }
  const tally = (map, id, key) => {
    const row = map.get(id) ?? { won: 0, lost: 0 }
    row[key] += 1
    map.set(id, row)
  }
  for (const match of matches) {
    const mine = match.teamA.includes(me) ? 'A' : 'B'
    const won = match.winner === mine
    const [ours, theirs] = mine === 'A' ? [match.teamA, match.teamB] : [match.teamB, match.teamA]
    for (const id of theirs) tally(against, id, won ? 'won' : 'lost')
    for (const id of ours) if (id !== me) tally(together, id, won ? 'won' : 'lost')
  }
  const met = new Set([...against.keys(), ...together.keys()])
  // A hidden name is never shown; otherwise people you have played see it, and strangers only by their own choice.
  const nameOf = (id) => {
    const who = people.get(id)
    return who.nameVisible && (met.has(id) || who.nearRatingName) ? who.name : null
  }
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const matchRivals = [...against]
    .filter(([id, r]) => people.has(id) && r.won + r.lost >= 2 && Math.abs(r.won - r.lost) <= 1)
    .map(([id, r]) => ({ id, kind: 'matches', won: r.won, lost: r.lost }))
    .sort((a, b) => b.won + b.lost - (a.won + a.lost) || byId(a, b))

  const mine = ratings.get(me)
  const counts = (r) => r && r.matches >= minMatches
  const ratingRivals = !counts(mine) ? [] : [...ratings]
    .filter(([id, r]) => id !== me && people.has(id) && counts(r) && Math.abs(r.points - mine.points) <= RATING_GAP
      && !matchRivals.some((m) => m.id === id))
    .map(([id, r]) => ({ id, kind: 'rating', gap: Math.abs(r.points - mine.points) }))
    .sort((a, b) => a.gap - b.gap || byId(a, b))
    .map(({ id, kind }) => ({ id, kind, won: against.get(id)?.won ?? 0, lost: against.get(id)?.lost ?? 0 }))

  const partners = [...together]
    .filter(([id, r]) => people.has(id) && r.won >= 2)
    .map(([id, r]) => ({ id, wins: r.won, losses: r.lost }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || byId(a, b))

  return {
    rivals: [...matchRivals, ...ratingRivals].slice(0, SHOWN).map((r) => ({ ...r, name: nameOf(r.id) })),
    partners: partners.slice(0, SHOWN).map((p) => ({ ...p, name: nameOf(p.id) })),
  }
}

/** "Dani and 2 rivals are going". `going` is in block order, rivals first. */
export function alertTitle(going) {
  if (going.length === 0) return null
  const first = going.find((g) => g.name)
  if (!first) return going.length === 1 ? 'A player near your rating is going' : `${going.length} players near your rating are going`
  const rest = going.filter((g) => g !== first)
  const count = (kind, word) => {
    const n = rest.filter((g) => g.kind === kind).length
    return n === 0 ? null : `${n} ${word}${n === 1 ? '' : 's'}`
  }
  const parts = [count('rival', 'rival'), count('partner', 'partner')].filter(Boolean)
  if (parts.length === 0) return `${first.name} is going`
  if (parts.length === 1) return `${first.name} and ${parts[0]} are going`
  return `${first.name}, ${parts[0]} and ${parts[1]} are going`
}

/** Now, unless it is 10 PM to 7 AM in Manila: then the next 7 AM. */
export function sendAfter(now) {
  const hour = manilaHour(now)
  if (hour >= 7 && hour < 22) return now
  const morning = new Date(manilaDayStart(now).getTime() + 7 * HOUR)
  return morning > now ? morning : new Date(morning.getTime() + 24 * HOUR)
}

/** The push service's way of saying this phone's subscription no longer exists. */
export function pushGone(statusCode) {
  return statusCode === 404 || statusCode === 410
}
