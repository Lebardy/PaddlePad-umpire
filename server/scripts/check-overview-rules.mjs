#!/usr/bin/env node
// ============================================================
// Overview rules that need no database: which matches are worth a
// look, which players might be the same person, and when a merge or a
// void is allowed.
//
//   node server/scripts/check-overview-rules.mjs
// ============================================================

const rules = await import('../src/overview-rules.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`),
  )
}
const section = (title) => console.log(`\n${title}`)

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.parse('2026-09-20T12:00:00Z')
const done = (overrides = {}) => ({
  status: 'completed', startedAt: now - 20 * MIN, endedAt: now - 5 * MIN, endedEarly: false, score: { A: 11, B: 7 }, ...overrides,
})
const reasonsOf = (match) => rules.matchReasons(match, now).map((r) => r.reason)
const tagsOf = (match) => rules.matchReasons(match, now).map((r) => r.tag)

section('how long something took, in words')
{
  check('under a minute', rules.durationText(40_000), 'under a minute')
  check('one minute', rules.durationText(MIN), '1 minute')
  check('two minutes', rules.durationText(2 * MIN + 30_000), '2 minutes')
  check('a whole hour', rules.durationText(HOUR), '1 hour')
  check('whole hours', rules.durationText(4 * HOUR), '4 hours')
  check('hours and minutes', rules.durationText(HOUR + 40 * MIN), '1 h 40 min')
}

section('matches worth a look')
{
  check('an ordinary finished match is not flagged', reasonsOf(done()), [])
  check('an ordinary match still going is not flagged',
    reasonsOf({ status: 'in_progress', startedAt: now - HOUR, endedAt: null, endedEarly: false, score: { A: 3, B: 4 } }), [])
  check('stuck: in progress for more than 3 hours',
    tagsOf({ status: 'in_progress', startedAt: now - 4 * HOUR, endedAt: null, endedEarly: false, score: { A: 3, B: 4 } }),
    ['In progress for 4 hours'])
  check('exactly 3 hours in progress is not stuck',
    reasonsOf({ status: 'in_progress', startedAt: now - 3 * HOUR, endedAt: null, endedEarly: false, score: { A: 3, B: 4 } }), [])
  check('ended early names the score', tagsOf(done({ endedEarly: true, score: { A: 7, B: 4 } })), ['Ended early at 7–4'])
  check('a shutout to 11', tagsOf(done({ score: { A: 11, B: 0 } })), ['Ended 11–0'])
  check('a shutout the other way round reads winner first', tagsOf(done({ score: { A: 0, B: 15 } })), ['Ended 15–0'])
  check('a shutout to 21', tagsOf(done({ score: { A: 21, B: 0 } })), ['Ended 21–0'])
  check('11–1 is not a shutout', reasonsOf(done({ score: { A: 11, B: 1 } })), [])
  check('ended early at 5–0 is ended early, not a shutout', reasonsOf(done({ endedEarly: true, score: { A: 5, B: 0 } })), ['ended_early'])
  check('very short: 2 minutes', tagsOf(done({ startedAt: now - 7 * MIN, endedAt: now - 5 * MIN })), ['Lasted 2 minutes'])
  check('exactly 3 minutes is not very short', reasonsOf(done({ startedAt: now - 8 * MIN, endedAt: now - 5 * MIN })), [])
  check('very long: 1 h 40 min', tagsOf(done({ startedAt: now - 105 * MIN, endedAt: now - 5 * MIN })), ['Lasted 1 h 40 min'])
  check('exactly 90 minutes is not very long', reasonsOf(done({ startedAt: now - 95 * MIN, endedAt: now - 5 * MIN })), [])
  check('several reasons at once, in a fixed order',
    reasonsOf(done({ startedAt: now - 7 * MIN, endedAt: now - 5 * MIN, score: { A: 11, B: 0 } })), ['shutout', 'short'])
  check('a finished match with no end time is judged on score only',
    reasonsOf(done({ endedAt: null, score: { A: 11, B: 0 } })), ['shutout'])
  check('dates may be ISO strings',
    reasonsOf({ status: 'in_progress', startedAt: new Date(now - 5 * HOUR).toISOString(), endedAt: null, endedEarly: false, score: { A: 0, B: 0 } }),
    ['stuck'])
}

section('names')
{
  check('capitals and extra spaces are ignored', rules.normalizeName('  Jon   CRUZ '), 'jon cruz')
  check('distance: one letter added', rules.letterDistance('jon cruz', 'john cruz'), 1)
  check('distance: ana / ian', rules.letterDistance('ana', 'ian'), 2)
  check('distance: identical', rules.letterDistance('mia', 'mia'), 0)
  check('Jon Cruz / John Cruz is a typo', rules.nameReason('Jon Cruz', 'John Cruz'), { reason: 'typo', text: 'Names differ by one letter' })
  check('two letters apart in long names is a typo', rules.nameReason('Jonathan Cruz', 'Jonatan Kruz'), { reason: 'typo', text: 'Names differ by two letters' })
  check('three letters apart is not flagged', rules.nameReason('Paolo Lim', 'Pablo Lam Jr'), null)
  check('Ana / Ian is not flagged', rules.nameReason('Ana', 'Ian'), null)
  check('Jan / Jana is not flagged (short names need the same length)', rules.nameReason('Jan', 'Jana'), null)
  check('Jon / Jan is flagged (short, same length, one letter)', rules.nameReason('Jon', 'Jan'), { reason: 'typo', text: 'Names differ by one letter' })
  check('Mia / Mia Santos is a short vs full name', rules.nameReason('Mia', 'Mia Santos'), { reason: 'short_name', text: 'One name is the start of the other' })
  check('the order does not matter', rules.nameReason('Mia Santos', 'mia'), { reason: 'short_name', text: 'One name is the start of the other' })
  check('Mia / Miala Santos is not a short name (not a whole word)', rules.nameReason('Mia', 'Miala Santos'), null)
  check('names equal apart from spacing are a typo', rules.nameReason('Mia  Santos', 'mia santos'), { reason: 'typo', text: 'Names differ only in capitals or spaces' })
  check('completely different names are not flagged', rules.nameReason('Bea Tan', 'Luis Ocampo'), null)
}

section('pairs')
{
  check('a pair key puts the smaller id first', rules.pairKey('b', 'a'), 'a:b')
  const shared = rules.sharedMatchPairs([{ teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] }])
  check('everyone in a match shares it with everyone else', [...shared].sort(),
    ['p1:p2', 'p1:p3', 'p1:p4', 'p2:p3', 'p2:p4', 'p3:p4'])
  // Kat was added twice (k1, k2): each partnered Mia and Nia, never on court together.
  const day = rules.sameDayPairs([{
    playerIds: ['k1', 'k2', 'mia', 'nia', 'x', 'y', 'z'],
    matches: [
      { teamA: ['k1', 'mia'], teamB: ['nia', 'x'] },
      { teamA: ['k2', 'mia'], teamB: ['nia', 'y'] },
      { teamA: ['k1', 'nia'], teamB: ['mia', 'z'] },
      { teamA: ['k2', 'nia'], teamB: ['x', 'y'] },
    ],
  }])
  check('same people, same day finds the double entry', [...day], ['k1:k2'])
  // x and z each partnered only y once: common on a rotation night, not a sign of anything.
  const oneShared = rules.sameDayPairs([{
    playerIds: ['x', 'y', 'z', 'a', 'b', 'c', 'd'],
    matches: [{ teamA: ['x', 'y'], teamB: ['a', 'b'] }, { teamA: ['z', 'y'], teamB: ['c', 'd'] }],
  }])
  check('sharing just one partner is not enough', [...oneShared].filter((k) => k === 'x:z'), [])
  const singles = rules.sameDayPairs([{ playerIds: ['a', 'b', 'c'], matches: [{ teamA: ['a'], teamB: ['c'] }, { teamA: ['b'], teamB: ['c'] }] }])
  check('singles players have no partners, so are never paired this way', [...singles], [])
  const nobodyPlayed = rules.sameDayPairs([{ playerIds: ['a', 'b'], matches: [] }])
  check('two players who never played are not paired', [...nobodyPlayed], [])
}

section('duplicate pairs')
{
  const players = [
    { id: 'a1', name: 'Jon Cruz' }, { id: 'a2', name: 'John Cruz' },
    { id: 'b1', name: 'Mia' }, { id: 'b2', name: 'Mia Santos' },
    { id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Ian' },
    { id: 'k1', name: 'Kat Villanueva' }, { id: 'k2', name: 'Katrina V.' },
  ]
  const none = { sharedPairs: new Set(), sameDay: new Set(), dismissed: new Set() }
  check('names and same-day pairs are both found, each once', rules.duplicatePairs(players, { ...none, sameDay: new Set(['k1:k2']) }).map((p) => `${p.a}:${p.b}:${p.reason}`),
    ['a1:a2:typo', 'b1:b2:short_name', 'k1:k2:same_day'])
  check('a pair that shared a match is never flagged',
    rules.duplicatePairs(players, { ...none, sharedPairs: new Set(['a1:a2']) }).map((p) => `${p.a}:${p.b}`), ['b1:b2'])
  check('a dismissed pair is hidden',
    rules.duplicatePairs(players, { ...none, dismissed: new Set(['b1:b2']) }).map((p) => `${p.a}:${p.b}`), ['a1:a2'])
  check('the same-day reason reads in words',
    rules.duplicatePairs(players, { ...none, sameDay: new Set(['k1:k2']) }).find((p) => p.reason === 'same_day')?.text,
    'Same session, same partners, never played each other')
}

section('merging')
{
  const plain = (id) => ({ id, hasSignIn: false, closed: false })
  const signed = (id) => ({ id, hasSignIn: true, closed: false })
  check('sign-in: an umpire-made player has none', rules.hasSignIn({ username: null, password_hash: null, google_sub: null, claimed_at: null, registered_at: null }), false)
  check('sign-in: a claimed player has one', rules.hasSignIn({ claimed_at: '2026-09-01' }), true)
  check('sign-in: a Google player has one', rules.hasSignIn({ google_sub: 'g-1' }), true)
  check('two plain players may merge', rules.mergeRefusal({ keep: plain('a'), remove: plain('b'), sharedMatch: false, removeInLiveSession: false }), null)
  check('keeping the signed-in one is fine', rules.mergeRefusal({ keep: signed('a'), remove: plain('b'), sharedMatch: false, removeInLiveSession: false }), null)
  check('removing the signed-in one is refused', rules.mergeRefusal({ keep: plain('a'), remove: signed('b'), sharedMatch: false, removeInLiveSession: false }), rules.KEEP_SIGNED_IN_MESSAGE)
  check('both signed in is refused', rules.mergeRefusal({ keep: signed('a'), remove: signed('b'), sharedMatch: false, removeInLiveSession: false }), rules.BOTH_SIGNED_IN_MESSAGE)
  check('the same player twice is refused', rules.mergeRefusal({ keep: plain('a'), remove: plain('a'), sharedMatch: false, removeInLiveSession: false }), rules.SAME_PLAYER_MESSAGE)
  check('a closed account is refused', rules.mergeRefusal({ keep: plain('a'), remove: { ...plain('b'), closed: true }, sharedMatch: false, removeInLiveSession: false }), rules.CLOSED_MERGE_MESSAGE)
  check('players who shared a match are refused', rules.mergeRefusal({ keep: plain('a'), remove: plain('b'), sharedMatch: true, removeInLiveSession: false }), rules.SHARED_MATCH_MESSAGE)
  check('a player at a session going on is refused', rules.mergeRefusal({ keep: plain('a'), remove: plain('b'), sharedMatch: false, removeInLiveSession: true }), rules.LIVE_SESSION_MESSAGE)
  check('player ids live under these event keys', rules.PLAYER_ID_KEYS, ['actingPlayerId', 'playerId'])
}

section('void reasons')
{
  check('a reason is trimmed', rules.readVoidReason('  Test match  '), { reason: 'Test match' })
  check('an empty reason is refused', rules.readVoidReason('   '), { error: rules.VOID_REASON_MESSAGE })
  check('a missing reason is refused', rules.readVoidReason(undefined), { error: rules.VOID_REASON_MESSAGE })
  check('a long reason is refused', rules.readVoidReason('x'.repeat(301)), { error: rules.VOID_REASON_MESSAGE })
  check('300 characters is fine', rules.readVoidReason('x'.repeat(300)).reason?.length, 300)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
