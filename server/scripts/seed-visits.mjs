#!/usr/bin/env node
// ============================================================
// Fills staging's coming week with open play at its invented places,
// people going to it, and ratings of their visits in the last 7 days,
// so the Guests page and the app's open play have something in them.
//
//   node --env-file=server/.env.smoke --env-file=server/.env.seed \
//     server/scripts/seed-visits.mjs https://api-staging-8ac6.up.railway.app [--dry]
//
// STAGING ONLY, and through the API: the owner adds the open plays, each
// place's seed umpire hands out claim codes, and each player joins and
// rates from their own sign-in. Run seed-recent.mjs first, so there are
// visits in the last 7 days to rate.
//
// Each open play falls on one of the place's own usual nights, at its
// usual hour; everyone who played there in the last 7 days rates their
// visit. Only players who have already played at that place are used,
// and never one with a username or Google sign-in, or any of the real
// people named in SEED_REAL_PEOPLE.
//
// Safe to run again: a place that already has open play this week gets
// no more, and rating a visit again replaces the rating. Prints counts
// only, never a token or a code.
// ============================================================

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const DRY = process.argv.includes('--dry')
const PASSWORD = process.env.SEED_UMPIRE_PASSWORD
const OWNER_EMAIL = process.env.SMOKE_OWNER_EMAIL
const OWNER_PASSWORD = process.env.SMOKE_OWNER_PASSWORD
if (!API || !PASSWORD || !OWNER_EMAIL || !OWNER_PASSWORD || !/staging|localhost|127\.0\.0\.1/.test(API)) {
  console.error('usage: node --env-file=server/.env.smoke --env-file=server/.env.seed server/scripts/seed-visits.mjs <STAGING_API_URL> [--dry]')
  console.error('Refuses any API that is not staging or local.')
  process.exit(2)
}

// The same four as seed-recent.mjs: one seed umpire per invented place.
const SEED_UMPIRES = [
  'paolo.sy@example.com', // Boulevard Paddle Courts
  'tessa.ramos@example.com', // Piapi Sports Hub
  'noel.garcia@example.com', // Sibulan Community Court
  'bea.lim@example.com', // Valencia Highland Courts
]

// Real people on staging, kept out of the repo. Never claimed, joined or rated for.
const REAL_PEOPLE = new Set((process.env.SEED_REAL_PEOPLE ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean))
if (!REAL_PEOPLE.size) {
  console.error('SEED_REAL_PEOPLE is not set (server/.env.seed)')
  process.exit(2)
}

const MANILA_MS = 8 * 3_600_000
const HOUR = 3_600_000
const DAY_MS = 86_400_000

async function call(path, { method = 'GET', body, token } = {}) {
  for (;;) {
    const response = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    // Claiming is limited to 10 a minute; wait the window out.
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get('retry-after')) + 1) * 1000))
      continue
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path.replace(/\?.*/, '')} -> ${response.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : {}
  }
}

const chance = (p) => Math.random() < p
const sample = (list) => list[Math.floor(Math.random() * list.length)]
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
/** The Manila calendar day a moment falls on, as a day number. */
const manilaDay = (ms) => Math.floor((ms + MANILA_MS) / DAY_MS)

const now = Date.now()
const today = manilaDay(now)
const { token: owner } = await call('/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
const { facilities } = await call('/admin/facilities', { token: owner })

// Who may be used at all: active, no username, no password, no Google, not a real person.
const allowed = new Set()
for (let after = ''; ;) {
  const page = await call(`/admin/players?status=active${after && `&after=${encodeURIComponent(after)}`}`, { token: owner })
  for (const p of page.players) {
    if (p.username || p.signInMethods.some((m) => m !== 'claim code') || REAL_PEOPLE.has(p.name.toLowerCase())) continue
    allowed.add(p.id)
  }
  if (!page.next) break
  after = page.next
}

// ============================================================
// Each place: its usual nights, then one or two open plays this week
// ============================================================
const places = []
const plays = []
for (const email of SEED_UMPIRES) {
  const { token, umpire } = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  const facility = facilities.find((f) => f.name === umpire.facilityName)
  const { sessions } = await call('/sessions', { token })
  const history = []
  for (const session of sessions.filter((s) => !s.voided_at && s.match_count > 0)) {
    const { matches } = await call(`/matches/session/${session.id}`, { token })
    const played = matches.filter((m) => m.status === 'completed' && !m.voidedAt)
    if (played.length > 0) history.push({ id: session.id, name: session.name, matches: played })
  }
  const last = Math.max(...history.flatMap((s) => s.matches.map((m) => Date.parse(m.endedAt))))
  if (!facility || !(now - last <= 30 * DAY_MS)) {
    console.log(`${umpire.facilityName}: skipped, no play in the last 30 days`)
    continue
  }

  // Regulars turn up more often: weight each player by nights attended.
  const nightsOf = new Map()
  for (const session of history) {
    for (const id of new Set(session.matches.flatMap((m) => [...m.teamA, ...m.teamB]))) {
      if (allowed.has(id)) nightsOf.set(id, (nightsOf.get(id) ?? 0) + 1)
    }
  }
  places.push({ facility, token, history, nightsOf })
  const { openPlays } = await call(`/admin/facilities/${facility.id}/guests`, { token: owner })
  if (openPlays.length > 0 || nightsOf.size < 2) {
    console.log(`${facility.name}: no open play added, ${openPlays.length > 0 ? 'it already has some this week' : 'too few players to use'}`)
    continue
  }

  // A named night keeps its weekday and its usual hour; the most played come first.
  const nights = []
  for (const name of new Set(history.map((s) => s.name))) {
    const named = history.filter((s) => s.name === name)
    const starts = named.map((s) => Math.min(...s.matches.map((m) => Date.parse(m.startedAt))))
    const hour = Math.round(median(starts.map((ms) => (ms + MANILA_MS) % DAY_MS)) / HOUR)
    const weekday = manilaDay(Math.max(...starts)) % 7
    const day = today + ((weekday - (today % 7) + 7) % 7)
    const startsAt = day * DAY_MS - MANILA_MS + hour * HOUR
    const hours = Math.min(between(2, 3), 23 - hour)
    if (startsAt > now && hour >= 6 && hours >= 2) nights.push({ startsAt, hours, times: named.length })
  }
  nights.sort((a, b) => b.times - a.times)

  const fee = facility.hourlyFeeCentavos ? Math.round(facility.hourlyFeeCentavos / 5000) * 50 : 0
  for (const [i, night] of nights.slice(0, chance(0.5) ? 2 : 1).entries()) {
    const courts = between(1, Math.min(3, Math.max(1, Math.floor(nightsOf.size / 8))))
    plays.push({
      facility, token, nightsOf,
      body: {
        startsAt: new Date(night.startsAt).toISOString(),
        endsAt: new Date(night.startsAt + night.hours * HOUR).toISOString(),
        courts, spots: courts * 8, fee: fee ? String(fee) : null, umpire: i === 0,
      },
    })
  }
}

// How many go to each: a quarter of the spots to all of them, one exactly full.
const full = plays.filter((p) => p.body.spots <= p.nightsOf.size).sort((a, b) => a.body.spots - b.body.spots)[0]
for (const play of plays) {
  const most = Math.min(play.body.spots, play.nightsOf.size)
  play.going = play === full ? play.body.spots : between(Math.ceil(play.body.spots / 4), Math.min(most, play.body.spots - 1))
}

// ============================================================
// Add each, and claim and join who's going
// ============================================================
const playerTokens = new Map()
/** Signs in as a made-up player through their place's claim code, once. */
async function playerToken(id, umpireToken) {
  if (!playerTokens.has(id)) {
    const { claimCode } = await call(`/players/${id}/claim-code`, { token: umpireToken })
    playerTokens.set(id, (await call('/auth/player/claim', { method: 'POST', body: { code: claimCode } })).token)
  }
  return playerTokens.get(id)
}

let joins = 0
for (const play of plays) {
  const { facility, token, nightsOf, body } = play
  const pool = [...nightsOf]
  const going = []
  while (going.length < play.going) {
    const total = pool.reduce((sum, [, n]) => sum + n, 0)
    let roll = Math.random() * total
    const at = pool.findIndex(([, n]) => (roll -= n) <= 0)
    going.push(pool.splice(at, 1)[0][0])
  }
  if (!DRY) {
    const { openPlay } = await call(`/admin/facilities/${facility.id}/open-plays`, { method: 'POST', token: owner, body })
    for (const id of going) {
      await call(`/player/open-plays/${openPlay.id}/join`, { method: 'POST', token: await playerToken(id, token) })
      joins += 1
    }
  }
  const when = new Date(Date.parse(body.startsAt) + MANILA_MS).toUTCString().slice(0, 22)
  console.log(`${when}  ${facility.name}: ${(Date.parse(body.endsAt) - Date.parse(body.startsAt)) / HOUR} h, ${body.courts} courts, ${play.going}/${body.spots} going, ${body.fee ? `₱${body.fee}` : 'free'}${body.umpire ? ', umpire' : ''}`)
}

// ============================================================
// Everyone rates each visit of theirs still open to rating
// ============================================================
let ratings = 0
for (const { facility, token, history, nightsOf } of places) {
  let rated = 0
  for (const id of nightsOf.keys()) {
    for (const session of history) {
      // A visit can be rated for 7 days after their latest match in it; keep a few minutes clear of the edge.
      const theirs = session.matches.filter((m) => [...m.teamA, ...m.teamB].includes(id))
      if (theirs.length === 0 || now - Math.max(...theirs.map((m) => Date.parse(m.startedAt))) > 7 * DAY_MS - 10 * 60_000) continue
      const rating = chance(0.8)
        ? { score: between(4, 5), chips: ['Courts', 'Staff', 'Cleanliness'].filter(() => chance(0.3)) }
        : { score: between(2, 3), chips: [sample(['Waiting', 'Price'])] }
      if (!DRY) await call(`/player/sessions/${session.id}/rating`, { method: 'POST', token: await playerToken(id, token), body: rating })
      rated += 1
    }
  }
  ratings += rated
  console.log(`${facility.name}: ${rated} visit ratings`)
}

console.log(DRY
  ? `Dry run: ${plays.length} open plays, ${ratings} visit ratings planned, nothing sent.`
  : `Added ${plays.length} open plays and ${joins} joins, and sent ${ratings} visit ratings, from ${playerTokens.size} players.`)
