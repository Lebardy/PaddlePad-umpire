#!/usr/bin/env node
// ============================================================
// The scorekeeper split's seams between the phones' sync and the
// screens: a refused ask, take scoring back while the scorer undid a
// rally, which ruling the overview words, and when the scorer's phone
// gives the tapping up. No browser, no network: fetch is faked and
// localStorage is an in-memory Map.
//
//   node scripts/check-scorekeeper-sync.mjs
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
const PAOLO = '22222222-2222-4222-8222-222222222222'
const ME = '11111111-1111-4111-8111-111111111111'
const ev = (n) => ({ id: `e${n}`, type: 'rally', at: n, actingPlayerId: 'a1', outcome: 'winner', zone: 'open' })
const [r1, r2, r3] = [ev(1), ev(2), ev(3)]

let server = null // what GET /matches/:id answers
let offline = false
let askStatus = 200
let concludeStatus = 200
const logPuts = []
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '')
  const method = init.method ?? 'GET'
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
  if (offline) throw new TypeError('Failed to fetch')
  if (method === 'POST' && path === `/matches/${MID}/claim`) return json({ match: server })
  if (method === 'GET' && path === `/matches/${MID}`) return json({ match: server })
  if (method === 'PUT' && path === `/matches/${MID}/log`) { logPuts.push(JSON.parse(init.body)); return json({ match: server }) }
  if (method === 'PUT' && path === `/scorekeeping/${MID}`) {
    return askStatus === 200
      ? json({ scorekeeper: { id: PAOLO, name: 'Paolo Reyes', state: 'asked' } })
      : json({ error: 'Take scoring back first' }, askStatus)
  }
  if (method === 'POST' && path === `/matches/${MID}/conclude`) {
    return concludeStatus === 200 ? json({ match: server }) : json({ error: 'The score changed: check the last rally.' }, concludeStatus)
  }
  return json({})
}

const storage = await import('../src/lib/storage.js')
const sync = await import('../src/lib/sync.js')
const outbox = await import('../src/lib/outbox.js')
const localstore = await import('../src/lib/localstore.js')
const rules = await import('../server/src/scorekeeper-rules.js')

const base = {
  id: MID, sessionId: 's', createdAt: 1, startedAt: 1, endedAt: null, status: 'in_progress',
  teamA: ['a1'], teamB: ['b1'], stacking: { A: false, B: false }, firstServer: { team: 'A', playerId: 'a1' },
  rightStart: { A: 'a1', B: 'b1' }, pointTarget: 11, winner: null, recordedBy: ME,
}
const serverCopy = (events, scorekeeperState) => ({
  ...base, startedAt: new Date(1).toISOString(), events, rulings: [],
  scoringDevice: 'paolo-phone', scorekeeper: scorekeeperState ? { id: PAOLO, name: 'Paolo Reyes', state: scorekeeperState, seenAt: null } : null,
})
const setLocal = (m) => localstore.write('paddlepad.matches', [m])

// --- I1: a refused ask must not dead-letter or freeze the match ---
// Paolo tapped Start; the main umpire taps Keep scoring before her next poll shows it.
outbox.clearOutbox()
setLocal({ ...base, events: [r1], scoringDevice: 'joy-phone', scorekeeper: { id: PAOLO, name: 'Paolo Reyes', state: 'asked' } })
storage.askScorekeeper(MID, null)
askStatus = 409
server = serverCopy([r1, r2, r3], 'scoring')
await sync.drain()
check('I1: a refused ask is not dead-lettered', outbox.deadLetter().map((d) => d.key), [])
check('I1: the screen shows what the server really has', [storage.getMatch(MID).events.length, storage.getMatch(MID).scorekeeper?.state, storage.getMatch(MID).scorekeeperAsk], [3, 'scoring', undefined])

// Offline, the re-read fails: the ask stays queued and tries again.
outbox.clearOutbox()
setLocal({ ...base, events: [r1], scoringDevice: 'joy-phone', scorekeeper: { id: PAOLO, name: 'Paolo Reyes', state: 'asked' } })
storage.askScorekeeper(MID, null)
// The ask itself is refused, then the re-read has no connection.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  if ((init.method ?? 'GET') === 'GET') throw new TypeError('Failed to fetch')
  return realFetch(url, init)
}
await sync.drain()
check('I1: a failed re-read keeps the ask queued, not dead', [outbox.pending().length, outbox.deadLetter().length], [1, 0])
globalThis.fetch = realFetch
askStatus = 200

// --- I2: which ruling the overview words ---
const queuedRuling = { id: 'q1', matchId: MID, targetEventId: 'e6', kind: 'overturned' }
const sent = [{ id: 's1', targetEventId: 'e6', kind: 'stands', state: 'refused', refused: 'Too late' }]
check('I2: an unsent ruling is the newest', rules.newestRuling?.([queuedRuling], sent)?.state, 'queued')
check('I2: with none unsent, the server\'s first is', rules.newestRuling?.([], sent)?.id, 's1')
check('I2: with neither, none', rules.newestRuling?.([], []) ?? null, null)

// --- I3: take scoring back while the scorer undid a rally after the last poll ---
outbox.clearOutbox()
logPuts.length = 0
setLocal({ ...base, events: [r1, r2, r3], scoringDevice: 'paolo-phone', scorekeeper: { id: PAOLO, name: 'Paolo Reyes', state: 'scoring' } })
server = serverCopy([r1, r2], null)
const took = await sync.takeOverMatch(MID, { adopt: true })
check('I3: take back adopts the server\'s log', [took.status, storage.getMatch(MID).events.map((e) => e.id)], ['adopted', ['e1', 'e2']])
check('I3: the stale copy is never uploaded', logPuts.length, 0)

// --- I4: when the scorer's phone gives the tapping up ---
const must = (o) => rules.keeperMustYield?.({ isKeeper: true, wasScoring: false, blockedLog: false, completed: false, ...o })
check('I4: a blocked upload on a freshly opened screen yields', must({ blockedLog: true }), true)
check('I4: a screen that was scoring and lost it yields', must({ wasScoring: true }), true)
check('I4: still scoring, nothing blocked, no yield', must({}), false)
check('I4: a finished match never counts as taken back', must({ blockedLog: true, completed: true }), false)

// --- Match point: a won match waits for the umpire only while a scorekeeper is scoring ---
check('hold: won + scoring waits', rules.waitsForUmpire?.({ completed: true }, 'scoring'), true)
check('hold: won, no split finishes', rules.waitsForUmpire?.({ completed: true }, null), false)
check('hold: won, split only asked finishes', rules.waitsForUmpire?.({ completed: true }, 'asked'), false)
check('hold: not won, nothing to wait for', rules.waitsForUmpire?.({ completed: false }, 'scoring'), false)

// --- Match point on the phones ---
const tenWins = Array.from({ length: 10 }, (_, i) => ev(i + 1))
const tap = { actingPlayerId: 'a1', outcome: 'winner', zone: 'open' }
const scoring = { id: PAOLO, name: 'Paolo Reyes', state: 'scoring' }

outbox.clearOutbox()
setLocal({ ...base, events: tenWins, scorekeeper: scoring })
storage.addRallyEvent(MID, tap)
check('the scorekeeper\'s winning tap holds', [storage.getMatch(MID).status, storage.getMatch(MID).winner, storage.getMatch(MID).events.length], ['in_progress', null, 11])
storage.undoLastEvent(MID)
check('Undo reopens play', [storage.getMatch(MID).status, storage.getMatch(MID).events.length], ['in_progress', 10])

outbox.clearOutbox()
setLocal({ ...base, events: tenWins })
storage.addRallyEvent(MID, tap)
check('with no split the winning tap finishes, as today', [storage.getMatch(MID).status, storage.getMatch(MID).winner], ['completed', 'A'])

const wonEvents = [...tenWins, ev(11)]
outbox.clearOutbox()
setLocal({ ...base, events: wonEvents, scorekeeper: scoring })
storage.askConclude(MID, 'e11')
check('asking to conclude is queued on the match', storage.getMatch(MID).concludeAsk, { targetEventId: 'e11' })
offline = true
await sync.drain()
offline = false
check('offline it stays queued', [outbox.pending().length, outbox.deadLetter().length, storage.getMatch(MID).concludeAsk?.targetEventId], [1, 0, 'e11'])
server = { ...serverCopy(wonEvents, null), status: 'completed', winner: 'A' }
outbox.release(outbox.outboxKey('conclude', MID)) // clears the offline back-off
await sync.drain()
check('sent: the match is finished here too, nothing queued', [storage.getMatch(MID).status, storage.getMatch(MID).concludeAsk, outbox.pending().length, outbox.deadLetter().length], ['completed', undefined, 0, 0])

outbox.clearOutbox()
setLocal({ ...base, events: wonEvents, scorekeeper: scoring })
storage.askConclude(MID, 'e11')
concludeStatus = 409
server = serverCopy(tenWins, 'scoring')
await sync.drain()
concludeStatus = 200
check('refused: shows what the server has, nothing dead', [storage.getMatch(MID).status, storage.getMatch(MID).events.length, storage.getMatch(MID).concludeAsk, outbox.deadLetter().length], ['in_progress', 10, undefined, 0])

outbox.clearOutbox()
setLocal({ ...base, events: wonEvents, scorekeeper: scoring })
server = { ...serverCopy(wonEvents, null), status: 'completed', winner: 'A' }
check('a concluded match is not a take-back', (await sync.yieldMatch(MID)).finished, true)
setLocal({ ...base, events: wonEvents, scorekeeper: scoring })
server = serverCopy(wonEvents, null)
check('a real take-back still is', (await sync.yieldMatch(MID)).finished, false)

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
