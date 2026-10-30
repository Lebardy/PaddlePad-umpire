#!/usr/bin/env node
// ============================================================
// Scorekeeper requests and rulings queued on the phone
// (storage.js askScorekeeper / queueRuling / undoLastEvent,
// sync.js push). No browser, no network: fetch is faked and
// localStorage is an in-memory Map.
//
//   node scripts/check-scorekeeper-queue.mjs
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
store.set('paddlepad.token', 'x')

const MID = '66666666-6666-4666-8666-666666666666'
const UMP = '99999999-9999-4999-8999-999999999999'
let rulingAnswer = 201
let scorekeeperBodies = []
let rulingCalls = 0
let scorekeeperDelay = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UMP2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

globalThis.fetch = async (url, init) => {
  const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '')
  const method = init?.method ?? 'GET'
  if (method === 'PUT' && path === `/scorekeeping/${MID}`) {
    const body = JSON.parse(init.body)
    scorekeeperBodies.push(body)
    await sleep(scorekeeperDelay)
    return new Response(JSON.stringify({ scorekeeper: { id: body.umpireId, name: 'Ana', state: 'asked', seenAt: null } }), { status: 200 })
  }
  if (method === 'POST' && path === `/scorekeeping/${MID}/rulings`) {
    rulingCalls += 1
    return new Response(JSON.stringify(rulingAnswer === 201 ? { ruling: {} } : { error: 'Too late: the next rally began' }), { status: rulingAnswer })
  }
  return new Response('{}', { status: 200 })
}

const storage = await import('../src/lib/storage.js')
const sync = await import('../src/lib/sync.js')

const base = {
  id: MID, sessionId: 's', createdAt: 1, startedAt: 1, endedAt: null,
  status: 'in_progress', teamA: ['a1'], teamB: ['b1'], stacking: { A: false, B: false },
  firstServer: { team: 'A', playerId: 'a1' }, rightStart: { A: 'a1', B: 'b1' }, pointTarget: 11, winner: null,
}
const rally = { id: 'e1', type: 'rally', actingPlayerId: 'a1', outcome: 'winner', zone: null }
const note = { id: 'e2', type: 'ruling', kind: 'stands', targetEventId: 'e1' }
store.set('paddlepad.matches', JSON.stringify([{ ...base, events: [rally, note] }]))

check('Undo leaves a ruling note in place', storage.undoLastEvent(MID).events.length, 2)

storage.askScorekeeper(MID, { id: UMP, name: 'Ana' })
check('asking shows the umpire as asked at once', storage.getMatch(MID).scorekeeper.state, 'asked')
await sync.drain()
check('the request went up with the umpire id', scorekeeperBodies.map((b) => b.umpireId), [UMP])
check('the answer replaced the local ask', storage.getMatch(MID).scorekeeperAsk, undefined)

const id = storage.queueRuling(MID, 'e1', 'overturned')
check('a ruling waits on the phone', storage.getQueuedRulings().map((r) => r.id), [id])
await sync.drain()
check('a taken ruling leaves the queue', storage.getQueuedRulings(), [])

storage.queueRuling(MID, 'e1', 'replay')
rulingAnswer = 409
await sync.drain()
check('a refused ruling is sent once and dropped', [rulingCalls, storage.getQueuedRulings().length], [2, 0])

// A second ask made while the first is in flight must not be wiped.
scorekeeperBodies = []
scorekeeperDelay = 50
storage.askScorekeeper(MID, { id: UMP, name: 'Ana' })
const first = sync.drain()
await sleep(10)
storage.askScorekeeper(MID, { id: UMP2, name: 'Bea' })
await first
check('the newer ask is still queued after the first reply', storage.getMatch(MID).scorekeeperAsk, { umpireId: UMP2 })
await sync.drain()
check('the next push sends the newer ask', scorekeeperBodies.map((b) => b.umpireId), [UMP, UMP2])
scorekeeperDelay = 0

// A ruling refused for good (match gone) must not stay as "Waiting to send".
rulingAnswer = 404
storage.queueRuling(MID, 'e1', 'stands')
await sync.drain()
check('a ruling refused with 404 leaves the queue', storage.getQueuedRulings(), [])

// A pull keeps whose match it is and who taps; a list pull keeps local rulings.
const fromServer = { ...base, startedAt: new Date(1).toISOString(), recordedBy: 'u1', recordedByName: 'Joy', scorekeeper: { id: UMP, name: 'Ana', state: 'scoring', seenAt: null } }
storage.replaceServerState({ matches: [{ ...fromServer, events: [rally], rulings: [{ id: 'r1', kind: 'stands' }] }] })
storage.replaceServerState({ matches: [fromServer] })
const pulled = storage.getMatch(MID)
check('a pulled match keeps recordedBy and scorekeeper', [pulled.recordedBy, pulled.recordedByName, pulled.scorekeeper.state], ['u1', 'Joy', 'scoring'])
check('a pull without rulings keeps the local ones', pulled.rulings.map((r) => r.id), ['r1'])

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
