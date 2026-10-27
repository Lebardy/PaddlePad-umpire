#!/usr/bin/env node
// ============================================================
// Sets off an open play phone alert on demand, on STAGING only.
//
//   node --env-file=server/.env.smoke server/scripts/push-test.mjs <pick|code|go|more|clean>
//
//   pick   once: chooses and claims the player and two rivals (see below)
//   code   how to sign in on the phone as the chosen seeded player (then tap the switch)
//   go     opens an open play at that player's place; rival 1 joins -> buzz
//   more   rival 2 joins the same one -> the alert updates, no buzz
//   clean  removes that open play and its joins (safe to run twice)
//
// pick finds a seeded player with 2+ rivals from the seeded matches, then
// claims that player and two rivals and gives each a username and password.
// Eligible: no login beyond a claim code, and not on SEED_REAL_PEOPLE. It needs
// --env-file=<main folder>/server/.env.seed for SEED_REAL_PEOPLE and
// SEED_UMPIRE_PASSWORD, and refuses if server/.env.push-test already holds a
// set. Each login is saved the moment it is made. The other commands never
// pick or claim; they need only the smoke env file.
// Needs SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD, as the smoke test does.
// ============================================================

import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { blockFor, sendAfter } from '../src/rivals.js'
import { manilaDayStart } from '../src/visit-rules.js'

const STAGING = 'https://api-staging-8ac6.up.railway.app'
const PLAY = 'https://play-staging-7f59.up.railway.app'
const API = (process.env.API_URL ?? STAGING).replace(/\/$/, '')
if (API !== STAGING) {
  console.error(`Refusing: ${API} is not staging`)
  process.exit(1)
}

const FILE = new URL('../.env.push-test', import.meta.url)
if (existsSync(FILE)) process.loadEnvFile(FILE)
const KEYS = ['PUSH_TEST_OPEN_PLAY', 'PUSH_TEST_FACILITY',
  ...['ME', 'ONE', 'TWO'].flatMap((k) => [`PUSH_TEST_${k}_NAME`, `PUSH_TEST_${k}_USER`, `PUSH_TEST_${k}_PASS`])]
const save = () => writeFileSync(FILE, KEYS.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}\n`).join(''), { mode: 0o600 })
const who = (k) => ({ name: process.env[`PUSH_TEST_${k}_NAME`], username: process.env[`PUSH_TEST_${k}_USER`], password: process.env[`PUSH_TEST_${k}_PASS`] })

async function api(path, { method = 'GET', body, bearer } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

function must(res, what, ok = [200, 201, 204]) {
  if (!ok.includes(res.status)) {
    console.error(`${what} failed: ${res.status} ${res.body.error ?? ''}`)
    process.exit(1)
  }
  return res.body
}

const cmd = process.argv[2]
if (!['pick', 'code', 'go', 'more', 'clean'].includes(cmd)) {
  console.error('usage: node --env-file=server/.env.smoke server/scripts/push-test.mjs <pick|code|go|more|clean>')
  process.exit(1)
}
if (!process.env.SMOKE_OWNER_EMAIL || !process.env.SMOKE_OWNER_PASSWORD) {
  console.error('SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD are needed (use --env-file=server/.env.smoke)')
  process.exit(1)
}

const SET = ['ME', 'ONE', 'TWO'].flatMap((k) => [`PUSH_TEST_${k}_NAME`, `PUSH_TEST_${k}_USER`, `PUSH_TEST_${k}_PASS`]).concat('PUSH_TEST_FACILITY')
if (cmd === 'pick' && SET.some((k) => process.env[k])) {
  console.error('server/.env.push-test already holds a player set (whole or part); pick will not claim more')
  process.exit(1)
}
if (cmd !== 'pick' && !SET.every((k) => process.env[k])) {
  console.error('no saved player set; run pick first')
  process.exit(1)
}

const owner = must(await api('/admin/auth/login', {
  method: 'POST', body: { email: process.env.SMOKE_OWNER_EMAIL, password: process.env.SMOKE_OWNER_PASSWORD },
}), 'owner sign-in').token

async function cancelOpenPlay() {
  const id = process.env.PUSH_TEST_OPEN_PLAY
  const facility = process.env.PUSH_TEST_FACILITY
  if (!id || !facility) return false
  // 404 means it is already gone, which is what clean wants.
  must(await api(`/admin/facilities/${facility}/open-plays/${id}`, { method: 'DELETE', bearer: owner }), 'removing the open play', [200, 204, 404])
  delete process.env.PUSH_TEST_OPEN_PLAY
  save()
  return true
}

if (cmd === 'clean') {
  console.log(await cancelOpenPlay() ? 'open play removed' : 'nothing to remove')
  process.exit(0)
}

// --- pick: a seeded player with real rivals, claimed with their logins saved as they are made ---
async function pickAndClaim() {
  const PASSWORD = process.env.SEED_UMPIRE_PASSWORD
  const same = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase()
  const real = new Set((process.env.SEED_REAL_PEOPLE ?? '').split(',').map(same).filter(Boolean))
  if (!PASSWORD || !real.size) {
    console.error('pick: add --env-file=<main folder>/server/.env.seed (SEED_UMPIRE_PASSWORD and SEED_REAL_PEOPLE)')
    process.exit(1)
  }
  // `everyone` is who the server counts as a rival (so the top 3 match its own); `eligible` is who may be claimed:
  // with no login of their own beyond a claim code (the seed scripts already claimed most), not a real person and not a smoke or phone test leftover.
  const everyone = new Map()
  const eligible = new Map()
  for (let after = ''; ;) {
    const page = must(await api(`/admin/players?status=active${after && `&after=${encodeURIComponent(after)}`}`, { bearer: owner }), 'listing players')
    for (const p of page.players) {
      everyone.set(p.id, { name: p.name, nameVisible: true, nearRatingName: false })
      if (!p.username && p.signInMethods.every((m) => m === 'claim code') && !real.has(same(p.name)) && !/phone|smoke/i.test(p.name)) {
        eligible.set(p.id, everyone.get(p.id))
      }
    }
    if (!page.next) break
    after = page.next
  }
  const { facilities } = must(await api('/admin/facilities', { bearer: owner }), 'listing places')
  const matches = []   // every counted match, with the place it was played at
  let umpireToken
  for (const email of ['paolo.sy', 'tessa.ramos', 'noel.garcia', 'bea.lim'].map((n) => `${n}@example.com`)) {
    const { token, umpire } = must(await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } }), 'seed umpire sign-in')
    umpireToken = token
    const facility = facilities.find((f) => f.name === umpire.facilityName)
    for (const session of must(await api('/sessions', { bearer: token }), 'listing nights').sessions) {
      if (session.voided_at || !session.match_count) continue
      for (const m of must(await api(`/matches/session/${session.id}`, { bearer: token }), 'listing matches').matches) {
        if (m.status === 'completed' && m.winner && !m.voidedAt) matches.push({ teamA: m.teamA, teamB: m.teamB, winner: m.winner, facility })
      }
    }
  }
  const withOpenPlay = new Map()
  for (const f of facilities) withOpenPlay.set(f.id, must(await api(`/admin/facilities/${f.id}/guests`, { bearer: owner }), 'reading open plays').openPlays.length > 0)

  const candidates = []
  for (const [me] of eligible) {
    const mine = matches.filter((m) => m.teamA.includes(me) || m.teamB.includes(me))
    const rivals = blockFor({ me, matches: mine, ratings: new Map(), people: everyone, minMatches: 1 }).rivals.filter((r) => eligible.has(r.id))
    if (rivals.length < 2) continue
    const seen = new Set(mine.flatMap((m) => [...m.teamA, ...m.teamB]))
    const homes = Map.groupBy(mine.filter((m) => m.facility), (m) => m.facility.id)
    if (homes.size === 0) continue
    const home = [...homes].sort((a, b) => b[1].length - a[1].length)[0][0]
    candidates.push({ me, rivals, people: seen.size - 1, home, open: withOpenPlay.get(home) ?? false })
  }
  candidates.sort((a, b) => b.open - a.open || b.people - a.people)

  // The claim code signs them in once; the username and password are what the phone keeps using.
  const claim = async (id, username, password) => {
    const { claimCode } = must(await api(`/players/${id}/claim-code`, { bearer: umpireToken }), 'making a claim code')
    const got = must(await api('/auth/player/claim', { method: 'POST', body: { code: claimCode } }), 'claiming')
    must(await api('/auth/player/credentials', { method: 'POST', bearer: got.token, body: { username, password } }), 'setting a login')
    return got
  }
  // Names show by construction here (everyone is treated as visible); the three are claimed only now, and each login is saved at once.
  const c = candidates[0]
  if (!c) { console.error('no seeded player has 2 rivals who can be claimed'); process.exit(1) }
  const set = (k, id, name) => {
    const username = `pt_${randomBytes(4).toString('hex')}`
    const password = randomBytes(12).toString('hex')
    return claim(id, username, password).then(() => {
      Object.assign(process.env, { [`PUSH_TEST_${k}_NAME`]: name, [`PUSH_TEST_${k}_USER`]: username, [`PUSH_TEST_${k}_PASS`]: password })
      save()
    })
  }
  process.env.PUSH_TEST_FACILITY = c.home
  await set('ME', c.me, eligible.get(c.me).name)
  const [one, two] = c.rivals
  await set('ONE', one.id, one.name)
  await set('TWO', two.id, two.name)
  console.log(`chosen: ${eligible.get(c.me).name}, ${c.people} people played, rivals ${one.name} (${one.won}-${one.lost}), ${two.name} (${two.won}-${two.lost}); place ${facilities.find((f) => f.id === c.home).name}${c.open ? '' : ' (no open plays yet)'}`)
  process.exit(0)
}
if (cmd === 'pick') await pickAndClaim()

const me = who('ME')
if (cmd === 'code') {
  console.log(`On the phone, open ${PLAY}`)
  console.log(`Sign in with username ${me.username} and the password in server/.env.push-test (PUSH_TEST_ME_PASS)`)
  console.log('Then open You, turn Alerts on and allow notifications.')
  process.exit(0)
}

const facility = process.env.PUSH_TEST_FACILITY
const join = async (rival, openPlayId) => {
  const got = must(await api('/auth/player/login', { method: 'POST', body: { username: rival.username, password: rival.password } }), 'rival sign-in')
  return must(await api(`/player/open-plays/${openPlayId}/join`, { method: 'POST', bearer: got.token }), 'joining').openPlay
}

if (cmd === 'go') {
  const now = new Date()
  if (sendAfter(now) > now) console.log('warning: quiet hours (22:00-07:00 Manila); the alert is held until 07:00')
  console.log('note: the API cannot say how many first alerts the player had today; the cap is 3 a day, so after 3 go runs no buzz comes')
  await cancelOpenPlay()
  // The next full hour after the next one; tomorrow 18:00 when that falls outside 6 am-8 pm.
  let start = new Date(Math.ceil((now.getTime() + 3_600_000) / 3_600_000) * 3_600_000)
  const hour = (start.getTime() - manilaDayStart(start).getTime()) / 3_600_000
  if (hour < 6 || hour > 20 || manilaDayStart(start).getTime() !== manilaDayStart(now).getTime()) {
    start = new Date(manilaDayStart(now).getTime() + 42 * 3_600_000)
  }
  const openPlay = must(await api(`/admin/facilities/${facility}/open-plays`, {
    method: 'POST', bearer: owner,
    body: { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 7_200_000).toISOString(), courts: 1, spots: 4, fee: '0', umpire: false, note: 'Phone test' },
  }), 'adding the open play').openPlay
  process.env.PUSH_TEST_OPEN_PLAY = openPlay.id
  save()
  await join(who('ONE'), openPlay.id)
  console.log(`open play on ${start.toISOString()}; ${who('ONE').name} joined`)
  console.log(`expect: phone buzzes within ~1 minute: "${who('ONE').name} is going"`)
} else {
  if (!process.env.PUSH_TEST_OPEN_PLAY) { console.error('no open play yet; run go first'); process.exit(1) }
  await join(who('TWO'), process.env.PUSH_TEST_OPEN_PLAY)
  console.log(`${who('TWO').name} joined`)
  console.log('expect: the alert text changes within ~1 minute, with no new buzz')
}
