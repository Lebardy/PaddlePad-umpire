#!/usr/bin/env node
// ============================================================
// A tap made while its match's log is being pushed must not be
// lost (src/lib/sync.js drain, src/lib/outbox.js resolve). No
// browser, no network.
//
//   node scripts/check-sync-race.mjs
//
// Runs the REAL storage, outbox and sync modules with fetch faked
// (the server takes 300 ms to answer a log push) and localStorage
// an in-memory Map. Before the fix, finishing a push deleted the
// outbox entry even when a newer tap had been made during it, so
// that tap was never sent and the next pull overwrote it locally.
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
const match = {
  id: '66666666-6666-4666-8666-666666666666', sessionId: 's', createdAt: 1, startedAt: 1, endedAt: null,
  status: 'in_progress', teamA: [A1, A2], teamB: [B1, B2], stacking: { A: false, B: false },
  firstServer: { team: 'A', playerId: A1 }, rightStart: { A: A1, B: B1 }, pointTarget: 11, events: [], winner: null,
}
store.set('paddlepad.token', 'tok')
store.set('paddlepad.matches', JSON.stringify([match]))

let serverEvents = []
let puts = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
globalThis.fetch = async (url, init) => {
  if (init?.method === 'PUT' && String(url).endsWith('/log')) {
    puts += 1
    const body = JSON.parse(init.body)
    await sleep(300) // the push is in flight for 300 ms
    serverEvents = body.events.map((e) => ({ ...e, seq: undefined }))
    return new Response(JSON.stringify({ match: { ...match, events: serverEvents } }), { status: 200 })
  }
  return new Response('{}', { status: 200 })
}

const { write } = await import('../src/lib/localstore.js')
const storage = await import('../src/lib/storage.js')
const sync = await import('../src/lib/sync.js')
const outbox = await import('../src/lib/outbox.js')

const shots = (events) =>
  events
    .filter((e) => e.type === 'thirdShot')
    .map((e) => `${e.shotType}${e.shotType === 'drop' ? (e.success ? '+' : '-') : ''}`)
const drop = (success) => ({ playerId: A1, shotType: 'drop', success })

console.log('no change during a push')
storage.tapThirdShot(match.id, { playerId: A1, shotType: 'drive', success: null })
puts = 0
await sync.drain()
check('exactly one push', puts, 1)
check('server has the tap', shots(serverEvents), ['drive'])
check('nothing left queued', outbox.pendingCount(), 0)

console.log('a corrected 3rd-shot tap during a push')
storage.tapThirdShot(match.id, drop(false))
puts = 0
const pushing = sync.drain()
await sleep(50)
storage.tapThirdShot(match.id, drop(true))
sync.flush() // what the 2 s debounce does after a tap; it lands mid-push
await pushing
check('server has the corrected tap only', shots(serverEvents), ['drop+'])
check('sent by that same awaited drain (two pushes)', puts, 2)
check('nothing left queued', outbox.pendingCount(), 0)

console.log('a pull afterwards')
storage.replaceServerState({ matches: [{ ...match, events: serverEvents }] })
check('local log still has the corrected tap', shots(storage.getMatch(match.id).events), ['drop+'])

console.log('a rally during a push')
storage.tapThirdShot(match.id, { playerId: A1, shotType: 'drive', success: null })
puts = 0
const pushing2 = sync.drain()
await sleep(50)
storage.addRallyEvent(match.id, { actingPlayerId: A1, outcome: 'winner', zone: 'open' })
sync.flush()
await pushing2
check('server has the rally', serverEvents.filter((e) => e.type === 'rally').length, 1)
check('sent by that same awaited drain (two pushes)', puts, 2)
check('nothing left queued', outbox.pendingCount(), 0)

console.log('an entry queued by the previous version (no mark) during a push')
write('paddlepad.outbox', {
  order: [`log:${match.id}`],
  entries: { [`log:${match.id}`]: { kind: 'log', entityId: match.id, dirtyAt: 1, attempts: 0, nextAttemptAt: 0, lastError: null, state: 'pending' } },
  deadLetter: [],
})
puts = 0
const pushing3 = sync.drain()
await sleep(50)
storage.tapThirdShot(match.id, drop(true))
sync.flush()
await pushing3
check('server has the tap made during the push', shots(serverEvents), ['drive', 'drop+'])
check('nothing left queued', outbox.pendingCount(), 0)

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
