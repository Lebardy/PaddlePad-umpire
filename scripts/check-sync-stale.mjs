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
let lease = null // device id holding the scoring lease; null = nobody
let serverHasSession = true
let serverEnded = false
let serverVoided = false // the session
let serverMatchVoided = false
let refuseDelete = false // a DELETE answers 409, as when another device scores
let deleteBodies = []
let failGets = false // every GET fails, as when offline

const serverMatch = () => ({ ...base, startedAt: new Date(1).toISOString(), events: serverEvents, voidedAt: serverMatchVoided ? 1 : null, scoringDevice: lease })
const json = (body) => new Response(JSON.stringify(body), { status: 200 })

globalThis.fetch = async (url, init) => {
  const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '')
  const method = init?.method ?? 'GET'
  if (method === 'PUT' && path === `/matches/${MID}/log`) {
    const body = JSON.parse(init.body)
    if (lease && lease !== body.deviceId) {
      return new Response(JSON.stringify({ error: 'Another device is scoring this match', heldBy: { umpireName: 'x' } }), { status: 409 })
    }
    serverEvents = body.events
    lease = body.deviceId // a saved log makes the pusher the scorer
    return json({ match: serverMatch() })
  }
  if (method === 'PUT' && path === `/sessions/${SID}/players`) {
    serverRoster = JSON.parse(init.body).playerIds
    return json({})
  }
  if (method === 'POST' && path === `/matches/${MID}/claim`) {
    lease = JSON.parse(init.body).deviceId
    await sleep(claimDelay)
    return json({ match: serverMatch() })
  }
  if (method === 'POST' && path === `/sessions/${SID}/end`) {
    serverEnded = JSON.parse(init.body).ended
    return json({ session: {} })
  }
  if (method === 'POST' && path === `/sessions/${SID}/void`) {
    serverVoided = JSON.parse(init.body).voided
    return json({ session: {} })
  }
  if (method === 'POST' && path === `/matches/${MID}/void`) {
    serverMatchVoided = JSON.parse(init.body).voided
    return json({ match: serverMatch() })
  }
  if (method === 'DELETE' && refuseDelete) {
    deleteBodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ error: 'Sam is scoring this match on another device', heldBy: { umpireName: 'Sam' } }), { status: 409 })
  }
  if (method === 'DELETE' && path === `/matches/${MID}`) {
    deleteBodies.push(JSON.parse(init.body))
    return new Response(null, { status: 204 })
  }
  if (method === 'DELETE' && path === `/sessions/${SID}`) {
    deleteBodies.push(JSON.parse(init.body))
    serverHasSession = false
    return new Response(null, { status: 204 })
  }
  if (failGets) throw new TypeError('offline')
  // A GET: the answer is fixed on arrival, delivered later.
  let answer = {}
  if (path === `/matches/${MID}`) answer = { match: serverMatch() }
  else if (path === `/sessions/${SID}`) answer = { session: { id: SID, name: 's', playerIds: [...serverRoster] }, players: [] }
  else if (path === '/sessions') {
    answer = { sessions: serverHasSession ? [{ id: SID, name: 's', created_at: 1, ended_at: serverEnded ? 1 : null, voided_at: serverVoided ? 1 : null, player_count: 1 }] : [] }
  } else if (path === '/players') answer = { players: [] }
  else if (path === `/matches/session/${SID}`) answer = { matches: [{ ...serverMatch(), events: undefined }] }
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
  write('paddlepad.tombstones', { sessions: [], matches: [] })
  write('paddlepad.matches', [{ ...base, events: local }])
  write('paddlepad.sessions', [{ id: SID, name: 's', createdAt: 1, playerIds: roster, playerCount: roster.length }])
  serverEvents = server
  serverRoster = roster
  getDelay = 0
  claimDelay = 0
  lease = null
  serverHasSession = true
  serverEnded = false
  serverVoided = false
  serverMatchVoided = false
  refuseDelete = false
  deleteBodies = []
  failGets = false
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
lease = 'other'
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
lease = 'other'
claimDelay = 300
const takingOver2 = sync.takeOverMatch(MID)
await sleep(50)
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
const result2 = await takingOver2
check('result is a conflict', result2.status, 'conflict')
check('local log still has the tap, not the server rally', ids(storage.getMatch(MID).events).includes('r2'), false)
check('local log has two events', storage.getMatch(MID).events.length, 2)
check('the tap is still queued', outbox.pendingCount(), 1)
await sync.drain()
check('a drain leaves the server rally', ids(serverEvents), ['r1', 'r2'])
check('the entry is still blocked', outbox.pending()[0]?.state, 'blocked')
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
await sync.drain()
check('a further tap and drain push nothing', ids(serverEvents), ['r1', 'r2'])

console.log('a takeover keeping the server, with a tap made during the claim')
reset({ local: [rally(1), rally(9)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
claimDelay = 300
const takingOver4 = sync.takeOverMatch(MID, { resolution: 'server' })
await sleep(50)
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
const result4 = await takingOver4
check('the earlier choice is dropped: conflict', result4.status, 'conflict')
await sync.drain()
check('the server is unchanged after a drain', ids(serverEvents), ['r1', 'r2'])

console.log('a blocked log whose lease the other device no longer holds')
reset({ local: [rally(1), rally(9)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
storage.addRallyEvent(MID, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
await sync.drain()
check('a tap and drain push nothing', ids(serverEvents), ['r1', 'r2'])

console.log('a core pull that is older than a session change pushed during it')
reset({ local: [], server: [] })
getDelay = 300
const pullingCore = sync.pullCore()
await sleep(50)
storage.setSessionEnded(SID)
await sync.drain()
await pullingCore
check('server has the end', serverEnded, true)
check('local session is still ended', Boolean(storage.getSession(SID)?.endedAt), true)

console.log('a session deleted during a core pull')
reset({ local: [], server: [] })
getDelay = 300
const pullingCore2 = sync.pullCore()
await sleep(50)
storage.deleteSession(SID)
await sync.drain()
await pullingCore2
check('server deleted it', serverHasSession, false)
check('it does not come back', storage.getSession(SID), null)

console.log('a takeover with no tap')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
const result3 = await sync.takeOverMatch(MID)
check('result is adopted', result3.status, 'adopted')
check('local is the server log', ids(storage.getMatch(MID).events), ['r1', 'r2'])
check('nothing queued', outbox.pendingCount(), 0)

console.log('a queued void or end, not yet pushed, then a pull that knows nothing of it')
reset({ local: [rally(1)], server: [rally(1)] })
storage.voidMatch(MID, 'x')
await sync.pullMatch(MID)
check('match pull keeps the void', Boolean(storage.getMatch(MID).voidedAt), true)
await sync.pullSession(SID)
check('session pull keeps the void', Boolean(storage.getMatch(MID).voidedAt), true)
await sync.drain()
check('server has the match voided', serverMatchVoided, true)

reset({ local: [], server: [] })
storage.setSessionEnded(SID)
await sync.pullCore()
check('core pull keeps the end', Boolean(storage.getSession(SID).endedAt), true)
await sync.drain()
check('server has the session ended', serverEnded, true)

reset({ local: [], server: [] })
storage.voidSession(SID, 'x')
await sync.pullCore()
check('core pull keeps the session void', Boolean(storage.getSession(SID).voidedAt), true)
await sync.drain()
check('server has the session voided', serverVoided, true)

console.log('who holds the scoring lease is kept locally')
reset({ local: [rally(1)], server: [rally(1)] })
lease = 'other'
await sync.pullMatch(MID)
check('a pull records the other device as the scorer', storage.getMatch(MID).scoringDevice, 'other')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
await sync.takeOverMatch(MID)
check('an adopt names this device', storage.getMatch(MID).scoringDevice, outbox.getDeviceId())
reset({ local: [rally(1), rally(2)], server: [rally(1)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
await sync.takeOverMatch(MID)
check('a push-mine takeover names this device', storage.getMatch(MID).scoringDevice, outbox.getDeviceId())

console.log('a change in the couldn\'t-sync list is not overwritten by a pull')
reset({ local: [rally(1), rally(9)], server: [rally(1)] })
outbox.markDirty('log', MID)
outbox.killEntry(outbox.outboxKey('log', MID), 'refused')
await sync.pullMatch(MID)
check('local keeps the refused log', ids(storage.getMatch(MID).events), ['r1', 'r9'])
outbox.discardDead(outbox.outboxKey('log', MID))
await sync.pullMatch(MID)
check('after discarding, a pull applies the server log', ids(storage.getMatch(MID).events), ['r1'])

console.log('a takeover adopt clears a refused log line')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.killEntry(outbox.outboxKey('log', MID), 'refused')
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
await sync.takeOverMatch(MID)
check('the couldn\'t-sync list is empty', outbox.deadLetter().length, 0)

console.log('"Try again" does not release a blocked log')
reset({ local: [rally(1), rally(9)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.killEntry(outbox.outboxKey('log', MID), 'refused')
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
outbox.reviveDead(outbox.outboxKey('log', MID))
check('still blocked', outbox.pending()[0]?.state, 'blocked')
await sync.drain()
check('the server is unchanged', ids(serverEvents), ['r1', 'r2'])

console.log('a match pull on its way during a takeover adopt')
reset({ local: [rally(1)], server: [rally(1)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
getDelay = 300
const slowPull = sync.pullMatch(MID) // answer fixed as [r1]
await sleep(20)
getDelay = 0
serverEvents = [rally(1), rally(2)] // the other device scored
await sync.takeOverMatch(MID)
await slowPull
check('the older answer does not undo the adopt', ids(storage.getMatch(MID).events), ['r1', 'r2'])

console.log('the other device saves a rally while this device takes over')
const otherSaves = (events) =>
  fetch('http://x/matches/' + MID + '/log', { method: 'PUT', body: JSON.stringify({ deviceId: 'other', events }) })
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
getDelay = 100
const takingOver5 = sync.takeOverMatch(MID)
await sleep(50)
const late = await otherSaves([rally(1), rally(2), rally(3)]) // after the claim
await takingOver5
check('a save after the claim is refused', late.status, 409)
check('local and server agree after the adopt', ids(storage.getMatch(MID).events), ids(serverEvents))
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
await otherSaves([rally(1), rally(2), rally(3)]) // before the claim
await sync.takeOverMatch(MID)
check('a save before the claim is adopted', ids(storage.getMatch(MID).events), ['r1', 'r2', 'r3'])
check('and the server keeps it', ids(serverEvents), ['r1', 'r2', 'r3'])

console.log('a void not yet sent, then a takeover adopt')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
storage.voidMatch(MID, 'x')
await sync.takeOverMatch(MID)
check('local keeps the void', Boolean(storage.getMatch(MID).voidedAt), true)
check('local has the server log', ids(storage.getMatch(MID).events), ['r1', 'r2'])
await sync.drain()
check('the server gets the void', serverMatchVoided, true)

console.log('cancelling a match with an unsent blocked log')
reset({ local: [rally(1)], server: [rally(1)] })
outbox.markDirty('log', MID)
outbox.killEntry(outbox.outboxKey('log', MID), 'refused')
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
storage.deleteMatch(MID)
check('no log entry is left', outbox.pending().map((e) => e.key), [outbox.outboxKey('matchDelete', MID)])
check('nor a couldn\'t-sync line', outbox.deadLetter().length, 0)

console.log('another device voided the match, nothing queued here, then an adopt')
reset({ local: [rally(1)], server: [rally(1), rally(2)] })
serverMatchVoided = true
await sync.takeOverMatch(MID)
check('local is voided like the server', Boolean(storage.getMatch(MID).voidedAt), true)

console.log('cancelling a session with an unsent blocked log')
reset({ local: [rally(1)], server: [rally(1)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
storage.deleteSession(SID)
check('no log entry is left', outbox.pending().some((e) => e.kind === 'log'), false)

console.log('a choice made before the server log changed')
reset({ local: [rally(1), rally(9)], server: [rally(1), rally(2)] })
outbox.markDirty('log', MID)
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
lease = 'other'
const asked = await sync.takeOverMatch(MID)
check('first a conflict', asked.status, 'conflict')
serverEvents = [rally(1), rally(2), rally(3)] // the other device went on
const answered = await sync.takeOverMatch(MID, { resolution: 'mine', remoteLast: asked.remoteLast })
check('the choice is dropped: asked again', answered.status, 'conflict')
await sync.drain()
check('the server is unchanged', ids(serverEvents), ['r1', 'r2', 'r3'])
const chosen = await sync.takeOverMatch(MID, { resolution: 'mine', remoteLast: answered.remoteLast })
check('a choice about what the server holds now goes through', chosen.status, 'pushed')

console.log('the status changes when a log becomes blocked or unblocked')
reset({ local: [rally(1)], server: [rally(1)] })
outbox.markDirty('log', MID)
const before = sync.getSyncStatus()
outbox.block(outbox.outboxKey('log', MID), { heldBy: 'other' })
const during = sync.getSyncStatus()
check('same pending count', during.pending, before.pending)
check('blocked count differs', during.blocked !== before.blocked, true)
outbox.release(outbox.outboxKey('log', MID))
check('unblocking changes it back', sync.getSyncStatus().blocked, before.blocked)

console.log('a cancel the server refused')
reset({ local: [rally(1)], server: [rally(1)] })
storage.deleteMatch(MID)
await sync.drain()
check('the cancel sends this device\'s id', deleteBodies, [{ deviceId: outbox.getDeviceId() }])
check('it is gone here once the server has removed it', storage.getMatch(MID), null)
reset({ local: [rally(1)], server: [rally(1)] })
refuseDelete = true
storage.deleteMatch(MID)
await sync.drain()
check('a refused cancel waits in the couldn\'t-sync list', outbox.deadLetter().map((d) => d.key), [`matchDelete:${MID}`])
sync.discardDead(`matchDelete:${MID}`)
await sleep(100)
check('discarding it brings the match back', storage.getMatch(MID)?.id, MID)
reset({ local: [], server: [] })
refuseDelete = true
storage.deleteSession(SID)
await sync.drain()
check('a refused session cancel sends the device id', deleteBodies, [{ deviceId: outbox.getDeviceId() }])
check('and waits in the list', outbox.deadLetter().map((d) => d.key), [`sessionDelete:${SID}`])
sync.discardDead(`sessionDelete:${SID}`)
await sleep(100)
check('discarding it brings the session back', storage.getSession(SID)?.id, SID)
check('and its match', storage.getMatch(MID)?.id, MID)

console.log('a dismissed session cancel when the pulls fail')
reset({ local: [], server: [] })
refuseDelete = true
storage.deleteSession(SID)
await sync.drain()
failGets = true
sync.discardDead(`sessionDelete:${SID}`)
await sleep(100)
failGets = false
refuseDelete = false
await sync.pullCore()
await sync.pullSession(SID)
check('a later pull brings the session and its match back', [storage.getSession(SID)?.id, storage.getMatch(MID)?.id], [SID, MID])

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
