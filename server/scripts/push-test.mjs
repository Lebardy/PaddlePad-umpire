#!/usr/bin/env node
// ============================================================
// Sets off an open play phone alert on demand, on STAGING only.
//
//   node --env-file=server/.env.smoke server/scripts/push-test.mjs <code|go|more|clean>
//
//   code   how to sign in as "Phone Test" on the phone (then tap the bell)
//   go     opens an open play at Phone Test's place; rival 1 joins -> buzz
//   more   rival 2 joins the same one -> the alert updates, no buzz
//   clean  removes that open play and its joins (safe to run twice)
//
// One fixed set of made-up players is reused: Phone Test and two rivals
// with a 1-1 record against it. They (and a made-up umpire and place to
// record the matches) are created only when missing, so a run never adds
// players. Their passwords live in the git-ignored server/.env.push-test.
// Needs SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD, as the smoke test does.
// ============================================================

import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { sendAfter } from '../src/rivals.js'
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
const KEYS = ['PUSH_TEST_PASSWORD', 'PUSH_TEST_OPEN_PLAY']
const save = () => writeFileSync(FILE, KEYS.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}\n`).join(''), { mode: 0o600 })

const PLACE = 'Phone Test Place'
const UMPIRE_EMAIL = 'phonetest.umpire@example.com'
const PEOPLE = {
  phone: { name: 'Phone Test', username: 'phonetest_me' },
  one: { name: 'Phone Rival One', username: 'phonetest_rival1' },
  two: { name: 'Phone Rival Two', username: 'phonetest_rival2' },
}

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
if (!['code', 'go', 'more', 'clean'].includes(cmd)) {
  console.error('usage: node --env-file=server/.env.smoke server/scripts/push-test.mjs <code|go|more|clean>')
  process.exit(1)
}
if (!process.env.SMOKE_OWNER_EMAIL || !process.env.SMOKE_OWNER_PASSWORD) {
  console.error('SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD are needed (use --env-file=server/.env.smoke)')
  process.exit(1)
}

const owner = must(await api('/admin/auth/login', {
  method: 'POST', body: { email: process.env.SMOKE_OWNER_EMAIL, password: process.env.SMOKE_OWNER_PASSWORD },
}), 'owner sign-in').token

/** The made-up place, or null when there is none yet. */
const findPlace = async () =>
  (must(await api('/admin/facilities', { bearer: owner }), 'listing places').facilities ?? []).find((f) => f.name === PLACE) ?? null

async function cancelOpenPlay() {
  const id = process.env.PUSH_TEST_OPEN_PLAY
  const place = await findPlace()
  if (!id || !place) return false
  // 404 means it is already gone, which is what clean wants.
  must(await api(`/admin/facilities/${place.id}/open-plays/${id}`, { method: 'DELETE', bearer: owner }), 'removing the open play', [200, 204, 404])
  delete process.env.PUSH_TEST_OPEN_PLAY
  save()
  return true
}

if (cmd === 'clean') {
  console.log(await cancelOpenPlay() ? 'open play removed' : 'nothing to remove')
  process.exit(0)
}

// --- the fixed set: found by sign-in, made only when missing ---
if (!process.env.PUSH_TEST_PASSWORD) {
  process.env.PUSH_TEST_PASSWORD = randomBytes(12).toString('hex')
  save()
}
const password = process.env.PUSH_TEST_PASSWORD

async function signIn(path, body, register) {
  const login = await api(path, { method: 'POST', body })
  if (login.status === 200) return login.body
  if (login.status !== 401 && login.status !== 404) must(login, 'sign-in')
  // An account that exists under another password answers 409 here, and the run stops.
  return must(await api(...await register()), 'registering (is the password in server/.env.push-test the one used before?)')
}

const me = {}
for (const [key, p] of Object.entries(PEOPLE)) {
  const got = await signIn('/auth/player/login', { username: p.username, password },
    async () => ['/auth/player/register', { method: 'POST', body: { name: p.name, username: p.username, password } }])
  me[key] = { ...p, id: got.player.id, token: got.token }
}

if (cmd === 'code') {
  console.log(`On the phone, open ${PLAY}`)
  console.log(`Sign in with username ${PEOPLE.phone.username} and password ${password}`)
  console.log('Then open You, turn Alerts on and allow notifications.')
  process.exit(0)
}

// --- make sure both rivals have a 1-1 record against Phone Test ---
const record = async () => must(await api('/player/rivals', { bearer: me.phone.token }), 'reading rivals').rivals
const has = (rivals, p) => rivals.find((r) => r.name === p.name && r.won === 1 && r.lost === 1)
let rivals = await record()
if (!has(rivals, me.one) || !has(rivals, me.two)) {
  let place = await findPlace()
  place ??= must(await api('/admin/facilities', { method: 'POST', bearer: owner, body: { name: PLACE } }), 'adding the place').facility
  const umpire = await signIn('/auth/login', { email: UMPIRE_EMAIL, password }, async () => {
    const invite = must(await api('/admin/invites', { method: 'POST', bearer: owner, body: { note: 'phone test', facilityId: place.id } }), 'making an invite').invite.code
    return ['/auth/register', { method: 'POST', body: { email: UMPIRE_EMAIL, name: 'Phone Test Umpire', password, invite } }]
  })
  const sid = crypto.randomUUID()
  const asUmpire = (path, o) => api(path, { ...o, bearer: umpire.token })
  must(await asUmpire('/sessions', { method: 'POST', body: { id: sid, name: 'Phone test night' } }), 'opening a session')
  must(await asUmpire(`/sessions/${sid}/players`, { method: 'PUT', body: { playerIds: Object.values(me).map((p) => p.id) } }), 'adding players')
  // The first player of team A wins every rally, so swapping sides gives one win each.
  for (const rival of [me.one, me.two].filter((r) => !has(rivals, r))) {
    for (const [a, b] of [[me.phone, rival], [rival, me.phone]]) {
      const id = crypto.randomUUID()
      must(await asUmpire('/matches', { method: 'POST', body: {
        id, sessionId: sid, teamA: [a.id], teamB: [b.id], firstServer: { team: 'A', playerId: a.id }, startedAt: Date.now() - 40 * 60_000,
      } }), 'starting a match')
      const done = must(await asUmpire(`/matches/${id}/log`, { method: 'PUT', body: {
        deviceId: 'push-test',
        events: Array.from({ length: 11 }, (_, seq) => ({ id: crypto.randomUUID(), seq, type: 'rally', at: Date.now(), actingPlayerId: a.id, outcome: 'winner', zone: 'open' })),
      } }), 'recording a match')
      if (done.match?.status !== 'completed') { console.error('a match did not finish'); process.exit(1) }
    }
  }
  must(await asUmpire(`/sessions/${sid}/end`, { method: 'POST', body: {} }), 'ending the session')
  rivals = await record()
  if (!has(rivals, me.one) || !has(rivals, me.two)) { console.error('both rivals should show 1-1 now, but do not'); process.exit(1) }
  console.log('made the 1-1 records between Phone Test and its rivals')
}

const place = await findPlace()
const join = async (rival, openPlayId) => must(await api(`/player/open-plays/${openPlayId}/join`, { method: 'POST', bearer: rival.token }), 'joining').openPlay

if (cmd === 'go') {
  const now = new Date()
  if (sendAfter(now) > now) console.log('warning: quiet hours (22:00-07:00 Manila); the alert is held until 07:00')
  console.log('note: the API cannot say how many first alerts Phone Test had today; the cap is 3 a day, so after 3 go runs no buzz comes')
  await cancelOpenPlay()
  // The next full hour after the next one; tomorrow 18:00 when that falls outside 6 am-8 pm.
  let start = new Date(Math.ceil((now.getTime() + 3_600_000) / 3_600_000) * 3_600_000)
  const hour = (start.getTime() - manilaDayStart(start).getTime()) / 3_600_000
  if (hour < 6 || hour > 20 || manilaDayStart(start).getTime() !== manilaDayStart(now).getTime()) {
    start = new Date(manilaDayStart(now).getTime() + 42 * 3_600_000)
  }
  const openPlay = must(await api(`/admin/facilities/${place.id}/open-plays`, {
    method: 'POST', bearer: owner,
    body: { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 7_200_000).toISOString(), courts: 1, spots: 4, fee: '0', umpire: false, note: 'Phone test' },
  }), 'adding the open play').openPlay
  process.env.PUSH_TEST_OPEN_PLAY = openPlay.id
  save()
  await join(me.one, openPlay.id)
  console.log(`open play at ${PLACE} on ${start.toISOString()}; ${me.one.name} joined`)
  console.log(`expect: phone buzzes within ~1 minute: "${me.one.name} is going"`)
} else {
  if (!process.env.PUSH_TEST_OPEN_PLAY) { console.error('no open play yet; run go first'); process.exit(1) }
  await join(me.two, process.env.PUSH_TEST_OPEN_PLAY)
  console.log(`${me.two.name} joined`)
  console.log('expect: the alert text changes within ~1 minute, with no new buzz')
}
