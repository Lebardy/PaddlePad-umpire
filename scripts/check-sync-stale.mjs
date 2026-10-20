#!/usr/bin/env node
// ============================================================
// Two windows where a change made on this device was lost
// (src/lib/sync.js pull*, takeOverMatch; storage.js
// replaceServerState). No browser, no network.
//
//   node scripts/check-sync-stale.mjs
//
// Runs the REAL storage, outbox and sync modules with fetch faked
// and localStorage an in-memory Map. The fake server answers a GET
// with what it held WHEN THE REQUEST ARRIVED, then makes the device
// wait, so the answer is stale by the time it is applied.
//
//   1. A pull started before this device pushed something newer
//      overwrote it, and the next tap then PUT the older log.
//      Rosters had the same weakness.
//   2. A tap made while "Take over scoring" waited for the claim
//      was overwritten by the server's copy and never sent.
// ============================================================

import { register } from 'node:module'

// The app's modules import their siblings without extensions.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
      if (s.startsWith('.') && !/\\.[a-z]+$/i.test(s)) { try { return await next(s + '.js', c) } catch {} }
      return next(s, c)
    }`),
)

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const B1 = '33333333-3333-4333-8333-333333333333'
const B2 = '44444444-4444-4444-8444-444444444444'
const SID = '55555555-5555-4555-8555-555555555555'
const MID = '66666666-6666-4666-8666-666666666666'
const base = {
  id: MID, sessionId: SID, createdAt: 1, startedAt: 1, endedAt: null,
  status: 'in_progress', teamA: [A1, A2], teamB: [B1, B2], stacking: { A: false, B: false },
  firstServer: { team: 'A', playerId: A1 }, rightStart: { A: A1, B: B1 }, pointTarget: 11, winner: null,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// What the server holds, and how long it keeps a GET / a claim waiting.
let serverEvents = []
let serverRoster = []
let getDelay = 0
let claimDelay = 0

const serverMatch = () => ({ ...base, startedAt: new Date(1).toISOString(), events: serverEvents })
const json = (body) => new Response(JSON.stringify(body), { status: 200 })

globalThis.fetch = async (url, init) => {
  const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '')
  const method = init?.method ?? 'GET'
  if (method === 'PUT' && path === `/matches/${MID}/log`) {
    serverEvents = JSON.parse(init.body).events
    return json({ match: serverMatch() })
  }
  if (method === 'PUT' && path === `/sessions/${SID}/players`) {
    serverRoster = JSON.parse(init.body).playerIds
    return json({})
  }
  if (method === 'POST' && path === `/matches/${MID}/claim`) {
    await sleep(claimDelay)
    return json({ match: serverMatch() })
  }
  // A GET: the answer is fixed on arrival, delivered later.
  let answer = {}
  if (path === `/matches/${MID}`) answer = { match: serverMatch() }
  else if (path === `/sessions/${SID}`) answer = { session: { id: SID, name: 's', playerIds: [...serverRoster] }, players: [] }
  else if (path === `/matches/session/${SID}`) answer = { matches: [] }
  await sleep(getDelay)
  return json(answer)
}

const { write } = await import('../src/lib/localstore.js')
const storage = await import('../src/lib/storage.js')
const sync = await import('../src/lib/sync.js')
const outbox = await import('../src/lib/outbox.js')

const rally = (n) => ({ type: 'rally', id: `r${n}`, at: n, actingPlayerId: A1, outcome: 'winner', zone: 'open' })
const ids = (events) => events.map((e) => e.id)

// Starts a fresh device: both sides hold `local` / `server` events, nothing queued.
function reset({ local, server, roster = [A1] }) {
  store.clear()
  store.set('paddlepad.token', 'tok')
  write('paddlepad.matches', [{ ...base, events: local }])
  write('paddlepad.sessions', [{ id: SID, name: 's', createdAt: 1, playerIds: roster, playerCount: roster.length }])
  serverEvents = server
  serverRoster = roster
  getDelay = 0
  claimDelay = 0
  outbox.clearOutbox()
}

console.log('a match pull that is older than a push made during it')
reset({ local: [rally(1)], server: [rally(1)] })
getDelay = 300
const pulling = sync.pullMatch(MID)
await sleep(50)
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
await sync.drain()
await pulling
check('server got the rally', serverEvents.length, 2)
check('local log still has the rally', storage.getMatch(MID).events.length, 2)
getDelay = 0
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
await sync.drain()
check('the next tap does not shorten the server log', serverEvents.length, 3)

console.log('a pull with nothing pushed during it')
reset({ local: [rally(1)], server: [rally(1)] })
getDelay = 100
const pulling2 = sync.pullMatch(MID)
await sleep(20)
serverEvents = [rally(1), rally(2)] // another device scored
await pulling2 // answered before the change: still old
getDelay = 0
await sync.pullMatch(MID)
check('the server change is applied', ids(storage.getMatch(MID).events), ['r1', 'r2'])

console.log('a session pull that is older than a roster push made during it')
reset({ local: [], server: [], roster: [A1] })
getDelay = 300
const pullingSession = sync.pullSession(SID)
await sleep(50)
storage.addPlayerToSession(SID, A2)
await sync.drain()
await pullingSession
check('server has the new player', serverRoster, [A1, A2])
check('local roster still has the new player', storage.getSession(SID).playerIds, [A1, A2])

console.log('a takeover with a tap made during the claim, logs the same')
reset({ local: [rally(1)], server: [rally(1)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
claimDelay = 300
const takingOver = sync.takeOverMatch(MID)
await sleep(50)
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
const result = await takingOver
check('result is pushed', result.status, 'pushed')
check('local has the tap', storage.getMatch(MID).events.length, 2)
check('server has the tap', serverEvents.length, 2)

console.log('a takeover with a tap made during the claim, this device was behind')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
claimDelay = 300
const takingOver2 = sync.takeOverMatch(MID)
await sleep(50)
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
const result2 = await takingOver2
check('result is a conflict', result2.status, 'conflict')
check('local log still has the tap, not the server rally', ids(storage.getMatch(MID).events).includes('r2'), false)
check('local log has two events', storage.getMatch(MID).events.length, 2)
check('the tap is still queued', outbox.pendingCount(), 1)

console.log('a takeover with no tap')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
const result3 = await sync.takeOverMatch(MID)
check('result is adopted', result3.status, 'adopted')
check('local is the server log', ids(storage.getMatch(MID).events), ['r1', 'r2'])
check('nothing queued', outbox.pendingCount(), 0)

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
