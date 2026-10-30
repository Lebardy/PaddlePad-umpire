import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import {
  addRallyEvent,
  addServerCorrection,
  tapThirdShot,
  undoLastEvent,
  endMatchManually,
  deleteMatch,
  voidMatch,
  unvoidMatch,
} from '../lib/storage'
import { useMatch, usePlayers } from '../lib/useLocalStore'
import NotFound from './NotFound'
import TakeoverNotice from '../components/TakeoverNotice'
import MatchVideo from '../components/MatchVideo'
import * as sync from '../lib/sync'
import { getDeviceId, pending as queued } from '../lib/outbox'
import { useSyncStatus } from '../lib/useSyncStatus'
import { useRulingsPoller } from '../lib/scorekeeping'
import { reentryMismatch, waitingReentry } from '../../server/src/scorekeeper-rules.js'
import { getStoredUmpire } from '../lib/api'
import { askScorekeeper, getMatch } from '../lib/storage'
import MatchOverview from './MatchOverview'
import ScorekeeperPicker from '../components/ScorekeeperPicker'
import { LEASE_MINUTES } from '../../server/src/scoring-lease.js'
import { deriveMatchState, currentServerPlayerId, courtSides } from '../lib/pickleball'
import { isSameThirdShot, waitingThirdShot } from '../lib/thirdShot'
import {
  FAULT_ENDINGS,
  RALLY_RULE,
  THIRD_SHOT_RULE,
  WINNING_ENDINGS,
  legacyRallyLabel,
  rallyEnding,
} from '../lib/outcomes'

// How often a device that is only WATCHING a match re-reads it. Slow
// enough to be negligible, fast enough that a watcher isn't looking at
// a score several rallies out of date.
const WATCH_POLL_MS = 8_000
// The match umpire follows a scorekeeper closely: the overview is their only view.
const SPLIT_POLL_MS = 2_000

// Remembered so the explanation is open for someone's first night and
// out of the way by their tenth -- the same bargain as the guide nudge
// on the home screen.
const LEGEND_KEY = 'paddlepad.umpire.legendCollapsed'

// Which team the court picture puts nearest the bottom of the screen,
// per match: the umpire's own end, so the picture matches the view.
const courtEndKey = (matchId) => `paddlepad.umpire.nearEnd.${matchId}`

function readNearEnd(matchId) {
  try {
    return localStorage.getItem(courtEndKey(matchId)) === 'B' ? 'B' : 'A'
  } catch {
    return 'A'
  }
}

function readLegendCollapsed() {
  try {
    return localStorage.getItem(LEGEND_KEY) === '1'
  } catch {
    return false
  }
}

// Every ending with what it means, in the two groups the buttons use.
function RallyLegend() {
  const [collapsed, setCollapsed] = useState(readLegendCollapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(LEGEND_KEY, next ? '1' : '0')
    } catch {
      // A phone with storage blocked still scores matches; it just
      // gets the explanation open again next time.
    }
  }

  return (
    <section className="rally-legend-wrap">
      <button className="collapsible-toggle" onClick={toggle} aria-expanded={!collapsed}>
        <Icon name="chevron" size={16} className={collapsed ? '' : 'icon-down'} />
        What do these mean?
      </button>
      {!collapsed && (
        <div className="rally-legend">
          <p className="rally-legend-rule">{RALLY_RULE}</p>
          <p className="rally-legend-rule">
            <strong>3rd shot:</strong> {THIRD_SHOT_RULE}
          </p>
          {[
            ['Won with a shot', WINNING_ENDINGS, 'winner'],
            ['Lost by a fault', FAULT_ENDINGS, 'error'],
          ].map(([title, endings, tone]) => (
            <dl key={title} className={`rally-legend-list ${tone}`}>
              <p className="rally-legend-head">{title}</p>
              {endings.map((ending) => (
                <div key={ending.key}>
                  <dt><Icon name={ending.key} size={18} />{ending.label}</dt>
                  <dd>{ending.help}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * The "who" step for doubles, drawn as the court seen from the side,
 * where an umpire stands: one pair stacked on the left of the net, the
 * other stacked on the right, each player where they are standing right
 * now (see courtSides). `nearEnd` is the pair shown on the left. No
 * player is labelled left or right: an umpire may sit on either side
 * of the court, and the word would be wrong for half of them.
 *
 * Both pairs face the net, so they mirror each other. The left pair's
 * own right is at the bottom, nearest the umpire; the right pair,
 * facing the other way, has its right at the TOP -- which is what puts
 * the two players on the same sideline straight across the net from
 * each other, exactly where they are on court.
 */
function CourtPicker({ sides, nearEnd, serverId, name, onPick, onSwapEnds }) {
  const farEnd = nearEnd === 'A' ? 'B' : 'A'

  function spot(id) {
    return (
      <button key={id} className="who-btn" onClick={() => onPick(id)}>
        {name(id)}
        {id === serverId && <span className="who-serving">serving</span>}
      </button>
    )
  }

  return (
    <div className="who-court">
      <div className="who-half">
        {spot(sides[nearEnd].left)}
        {spot(sides[nearEnd].right)}
      </div>
      <div className="who-net">
        <span>Net</span>
      </div>
      <div className="who-half">
        {spot(sides[farEnd].right)}
        {spot(sides[farEnd].left)}
      </div>
      <button className="who-swap" onClick={onSwapEnds}>
        Swap ends
      </button>
    </div>
  )
}

/** The words for how a rally ended, including rallies from before details. */
function rallyLabel(event) {
  return rallyEnding(event.detail)?.label ?? legacyRallyLabel(event.outcome, event.zone)
}

const RULING_WORDS = { stands: 'call stands', overturned: 'overturned', replay: 'replay', wrongWinner: 'winner corrected' }

// Turns one logged event into the plain-English line shown in the
// history panel, so an umpire can glance back and confirm what was
// actually recorded without needing to remember button labels.
function describeEvent(event, name) {
  if (event.type === 'rally') {
    return `${rallyLabel(event)} — ${name(event.actingPlayerId)}`
  }
  if (event.type === 'serverCorrection') {
    return `Serve corrected — ${name(event.playerId)}`
  }
  if (event.type === 'ruling') {
    return `Umpire: ${RULING_WORDS[event.kind] ?? 'ruling'}`
  }
  const shotLabel =
    event.shotType === 'drop' ? (event.success ? 'Drop ✓' : 'Drop ✗') : 'Drive'
  return `3rd shot ${shotLabel} — ${name(event.playerId)}`
}

// The live courtside scoring screen for one match. Score, server
// rotation, and per-player stats are never held in local state
// directly -- every tap just appends an event via storage.js and then
// re-derives everything fresh with deriveMatchState, so this component
// can't drift out of sync with what's actually stored.
//
// A rally is logged in two taps: WHAT ended it, then WHO. That is the
// order it is seen from the side of the court -- the ball goes out, and
// only then does the eye go to whose shot it was. The one exception is
// an ending only the server can cause (an ace, a service or foot
// fault), which is credited to the server at once. Undo and the last
// thing logged sit right under the score, because correcting a mis-tap
// has to be as quick as making it.
function LiveMatch({ matchId, onBack }) {
  const match = useMatch(matchId)
  const [showHistory, setShowHistory] = useState(false)
  const [picking, setPicking] = useState(false)
  // The ending picked by the first tap, waiting for the player.
  const [pending, setPending] = useState(null)
  // A half-finished pick must not survive into a different match, or
  // outlive the match finishing underneath it (another device, say).
  const pickScope = `${matchId}|${match?.status}`
  const [pendingScope, setPendingScope] = useState(pickScope)
  if (pendingScope !== pickScope) {
    setPendingScope(pickScope)
    setPending(null)
  }
  // The team drawn at the near (bottom) end of the court picture.
  const [nearEnd, setNearEnd] = useState(() => readNearEnd(matchId))
  const knownPlayers = usePlayers()

  // Fetch this match's event log, which the session list deliberately
  // doesn't carry, and keep refreshing while ANOTHER device is the one
  // scoring.
  //
  // Without the refresh, a second device that merely has the match open
  // sits on whatever it loaded at mount. Its scoreboard silently falls
  // behind the real one, and -- worse -- a takeover from that stale
  // state used to overwrite the real scoring. Adopting the server's log
  // on takeover fixes the data loss; this stops the screen lying in the
  // meantime, and is what makes a finished match appear on the watching
  // device.
  //
  // It polls only when this device is NOT the scorer and the screen is
  // actually being looked at, so the umpire doing the scoring never
  // pays for it.
  const scoringDevice = match?.scoringDevice
  const isScorer = !scoringDevice || scoringDevice === getDeviceId()
  // A finished or voided match no longer changes, so watching it is pointless.
  const watching = !isScorer && match?.status === 'in_progress' && !match.voidedAt
  // A match made on this phone has no recordedBy until the server's copy is adopted.
  const me = getStoredUmpire()?.id
  const split = match?.scorekeeper?.state ? match.scorekeeper : null
  const iRunIt = Boolean(split) && (match.recordedBy ?? me) === me
  // The other umpire's match, which this phone only taps for.
  const isKeeper = split?.id === me && Boolean(match?.recordedBy) && match.recordedBy !== me
  const iScore = isKeeper && split.state === 'scoring'
  const polling = watching || iRunIt
  const pollMs = iRunIt ? SPLIT_POLL_MS : WATCH_POLL_MS

  const sideA = match?.teamA
  const sideB = match?.teamB
  const teamWords = useCallback(
    (team) => (team === 'A' ? sideA : sideB)?.map((id) => knownPlayers.find((p) => p.id === id)?.name ?? '?').join(' / '),
    [sideA, sideB, knownPlayers],
  )
  const [banner, clearBanner] = useRulingsPoller(matchId, iScore && isScorer, teamWords)
  const [takenBack, setTakenBack] = useState(null)

  // Scoring is taken back when the lease moves, the split ends, or this
  // phone's next upload is refused. Only a phone that WAS scoring as the
  // scorekeeper reacts, and only once.
  useSyncStatus()
  const blockedLog = queued().some((e) => e.kind === 'log' && e.entityId === matchId && e.state === 'blocked')
  const wasScoring = useRef(false)
  const yielding = useRef(false)
  useEffect(() => {
    if (iScore && isScorer && !blockedLog) {
      wasScoring.current = true
      return
    }
    // Finishing the match ends the split on the server; that is not a take-back.
    if (match?.status === 'completed') wasScoring.current = false
    if (!wasScoring.current || yielding.current) return
    yielding.current = true
    sync.yieldMatch(matchId).then(
      (result) => {
        wasScoring.current = false
        setTakenBack(result)
      },
      () => {}, // Offline: the next render tries again.
    ).finally(() => { yielding.current = false })
  })

  useEffect(() => {
    const controller = new AbortController()
    let timer = null

    const refresh = () => {
      sync.pullMatch(matchId, { signal: controller.signal }).catch(() => {})
    }
    refresh()

    if (polling) {
      const tick = () => {
        if (document.visibilityState === 'visible') refresh()
        timer = setTimeout(tick, pollMs)
      }
      timer = setTimeout(tick, pollMs)
    }

    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [matchId, polling, pollMs])

  function name(id) {
    return knownPlayers.find((p) => p.id === id)?.name ?? '?'
  }

  function logRally(actingPlayerId, ending) {
    const ruledFor = iScore ? waitingReentry(match.events, match.teamA) : null
    addRallyEvent(matchId, {
      actingPlayerId,
      outcome: ending.outcome,
      zone: ending.zone,
      detail: ending.key,
    })
    // The umpire ruled for one team; a tap that gives the point to the other is a mis-tap.
    if (reentryMismatch(ruledFor, match.teamA, getMatch(matchId).events.at(-1))) {
      undoLastEvent(matchId)
      alert(`That gives the point to ${teamWords(ruledFor === 'A' ? 'B' : 'A')}. The umpire ruled ${teamWords(ruledFor)}.`)
    }
    setPending(null)
  }

  function swapEnds() {
    const next = nearEnd === 'A' ? 'B' : 'A'
    setNearEnd(next)
    try {
      localStorage.setItem(courtEndKey(matchId), next)
    } catch {
      // Still swapped for as long as the screen is open.
    }
  }

  function logThirdShot(playerId, shotType, success) {
    tapThirdShot(matchId, { playerId, shotType, success })
  }

  // The app works out the server from the rules, and gets it right so
  // long as setup was told correctly who started on the right. This is
  // the umpire overruling it -- logged as an event, so Undo reaches it
  // like anything else, and it sticks for the rest of the game rather
  // than needing repeating at every side-out.
  function swapServer(currentServerId) {
    const team = match.teamA.includes(currentServerId) ? match.teamA : match.teamB
    const partner = team.find((id) => id !== currentServerId)
    if (partner) addServerCorrection(matchId, partner)
  }

  function handleUndo() {
    // Undo while a player is being picked means "not that one" -- the
    // pick is the last thing the umpire did, not the last rally.
    if (pending) {
      setPending(null)
      return
    }
    undoLastEvent(matchId)
  }

  // An unfinished match is removed outright -- wrong pairing, wrong
  // court, started by mistake. Nothing in it counted yet.
  function handleCancel() {
    // The server refuses too; this only saves the trip while the other
    // device's lease is fresh.
    if (watching && Date.now() - new Date(match.scoringClaimedAt).getTime() < LEASE_MINUTES * 60_000) {
      alert('Another device is scoring this match. Cancel it there, or wait until it has been idle for 15 minutes.')
      return
    }
    if (
      !confirm(
        'Cancel this match? It will be deleted along with everything scored so far.',
      )
    ) {
      return
    }
    if (deleteMatch(matchId)) onBack()
  }

  // A finished match is voided, not deleted. The play really happened;
  // it was just credited to the wrong people, and that is exactly what
  // has to be kept out of the ML export.
  function handleVoid() {
    const reason = prompt(
      'Void this finished match so it is excluded from the exported data?\n\nOptional reason:',
      '',
    )
    if (reason === null) return
    voidMatch(matchId, reason)
  }

  function handleEndEarly() {
    if (!confirm('End this match now? Final score will be locked in as-is.')) return
    endMatchManually(matchId)
  }

  // match.teamA / match.events were dereferenced unguarded below.
  if (!match) return <NotFound what="match" onBack={onBack} />

  // While a scorekeeper holds or is asked for the taps, no scoring control is
  // reachable here: the ask is sent after this phone's earlier taps, so none may follow it.
  // A new split on this match must not show an old notice.
  if (takenBack && !(iScore && isScorer)) {
    return (
      <div className="live-match">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <div className="scorekeeper-wait" role="status">
          <Icon name="undo" size={24} />
          <p>{match.recordedByName?.split(' ')[0]} took scoring back{takenBack.unsaved ? ` · ${takenBack.unsaved} taps not saved` : ''}</p>
        </div>
      </div>
    )
  }
  if (iRunIt && split.state === 'scoring') {
    return (
      <div className="live-match">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <MatchOverview match={match} name={name} onTakeBack={() => sync.takeOverMatch(matchId).catch(() => alert('Needs a connection'))} />
      </div>
    )
  }
  if (iRunIt) {
    const score = deriveMatchState(match).score
    return (
      <div className="live-match">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <div className="scorekeeper-wait" role="status">
          <span className="big-score">{score.A}–{score.B}</span>
          <p>
            <Icon name={split.state === 'declined' ? 'x' : 'timer'} size={18} />
            {split.state === 'declined' ? `${split.name} said not now` : match.scorekeeperAsk ? `Sending to ${split.name}` : `Waiting for ${split.name}`}
          </p>
          <div className="overview-actions">
            {split.state === 'declined' && <button onClick={() => setPicking(true)}><Icon name="people" size={18} />Someone else</button>}
            <button className="btn-quiet" onClick={() => askScorekeeper(matchId, null)}><Icon name="play" size={18} />Keep scoring</button>
          </div>
        </div>
        {picking && <ScorekeeperPicker matchId={matchId} onClose={() => setPicking(false)} />}
      </div>
    )
  }

  const derived = deriveMatchState(match)
  const players = [...match.teamA, ...match.teamB]
  const serverId =
    match.status === 'in_progress' ? currentServerPlayerId(derived, match) : null
  const servingTeamPlayers = derived.servingTeam === 'A' ? match.teamA : match.teamB
  const history = [...match.events].reverse()
  const lastRally = history.find((event) => event.type === 'rally')
  // Filled in on its button and named on the Last line, so a glance
  // down confirms the tap. A rally after it means it is no longer waiting.
  const waiting = waitingThirdShot(match.events)
  const picked = (playerId, shotType, success) =>
    isSameThirdShot(waiting, { playerId, shotType, success })
  const pendingEnding = pending ? rallyEnding(pending) : null
  const sides = match.status === 'in_progress' ? courtSides(derived, match) : null

  function pick(ending) {
    if (ending.by === 'server' && serverId) logRally(serverId, ending)
    else setPending(ending.key)
  }

  const teams = [
    { key: 'A', ids: match.teamA },
    { key: 'B', ids: match.teamB },
  ]

  return (
    <div className="live-match">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>

      {!isKeeper && <TakeoverNotice matchId={matchId} />}
      {iScore && (
        <p className="scoring-for"><Icon name="people" size={16} />Scoring for {match.recordedByName?.split(' ')[0]}</p>
      )}
      {banner && (
        <div className="ruling-banner" role="alert">
          <Icon name="flag" size={20} />
          <span><strong>{banner.who?.split(' ')[0]}:</strong> {banner.text}</span>
          <button className="icon-solo" onClick={clearBanner} aria-label="Dismiss"><Icon name="x" size={18} /></button>
        </div>
      )}

      {/* Everything tapped during a rally, in one block: the score and
          undo, the 3rd shot and the ending buttons (or the "who" step in
          the same place). It fits a tablet without scrolling in portrait,
          and in landscape down to about 720 px of height; Safari's bars on
          an iPad leave less. Explanations and the match controls sit
          below it. See App.css for the arrangements. */}
      <div className={`scoring${match.status === 'in_progress' ? ' is-live' : ''}`}>
        <div className="scoring-status">
          <div className="scoreboard" aria-label="Score">
            {teams.map(({ key, ids }) => {
              const serving = match.status === 'in_progress' && derived.servingTeam === key
              return (
                <div key={key} className={`score-side ${serving ? 'serving' : ''}`}>
                  <span className="score-names">
                    {ids.map((id) => (
                      <span key={id} className={id === serverId ? 'is-server' : undefined}>
                        {name(id)}
                      </span>
                    ))}
                  </span>
                  <span className="score-value">{derived.score[key]}</span>
                  {serving && <span className="serving-tag">Serving</span>}
                </div>
              )
            })}
          </div>

          {match.status === 'in_progress' && (
            <p className="serve-note">
              <span>
                <strong>{name(serverId)}</strong> serves
                {derived.isDoubles ? ` · server ${derived.serverNumber}` : ''}
                {' · '}first to {derived.pointTarget}
              </span>
              {derived.isDoubles && (
                <button className="swap-server" onClick={() => swapServer(serverId)}>
                  Not them?
                </button>
              )}
            </p>
          )}

          {match.status === 'completed' && (
            <p className="match-complete">
              {match.winner
                ? `${match.winner === 'A' ? match.teamA.map(name).join(' / ') : match.teamB.map(name).join(' / ')} won`
                : 'Match ended'}
            </p>
          )}

          {match.status === 'in_progress' && (
            <>
                  {/* The last thing logged, with its undo beside it: the check
                      an umpire makes after every tap, in one glance. */}
                  <div className="last-logged" aria-live="polite">
                    <span className="last-logged-text">
                      {pendingEnding
                        ? `${pendingEnding.label} — who?`
                        : history[0]?.type === 'serverCorrection'
                          ? `Last: ${describeEvent(history[0], name)}`
                          : waiting
                            ? `Last: ${describeEvent(waiting, name)}`
                            : lastRally
                              ? `Last: ${rallyLabel(lastRally)} — ${name(lastRally.actingPlayerId)}`
                              : 'No rallies yet'}
                    </span>
                    <button
                      className="undo"
                      onClick={handleUndo}
                      disabled={!pending && (match.events.length === 0 || match.events.at(-1)?.type === 'ruling')}
                    >
                      <Icon name="undo" size={18} />
                      {pending ? 'Back' : 'Undo'}
                    </button>
                  </div>
            </>
          )}
        </div>

        {match.status === 'in_progress' && (
          <div className="scoring-rally">
            {pendingEnding ? (
              <section
                className={`who-picker ${pendingEnding.outcome}`}
                aria-label={`Who — ${pendingEnding.label}`}
              >
                <p className="who-question">
                  {pendingEnding.outcome === 'winner'
                    ? 'Who hit it?'
                    : 'Who made the fault?'}
                </p>
                {sides ? (
                  <CourtPicker
                    sides={sides}
                    nearEnd={nearEnd}
                    serverId={serverId}
                    name={name}
                    onPick={(id) => logRally(id, pendingEnding)}
                    onSwapEnds={swapEnds}
                  />
                ) : (
                  // Singles: one player a side, nobody to tell apart.
                  <div className="who-teams">
                    {teams.map(({ key, ids }) => (
                      <div key={key} className="who-team">
                        {ids.map((id) => (
                          <button
                            key={id}
                            className="who-btn"
                            onClick={() => logRally(id, pendingEnding)}
                          >
                            {name(id)}
                            {id === serverId && <span className="who-serving">serving</span>}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <section className="rally-log" aria-label="How the rally ended">
                {[
                  ['Won with a shot', WINNING_ENDINGS, 'winner'],
                  ['Lost by a fault', FAULT_ENDINGS, 'error'],
                ].map(([title, endings, tone]) => (
                  <div key={tone} className={`ending-group ${tone}`}>
                    {/* The 3rd shot comes first, where the umpire is
                        already looking when a point ends: 3rd shot, how
                        it ended, who. Only the serving team hits it. */}
                    {tone === 'winner' && (
                      <div className="third-shot-row">
                        <h3>
                          3rd shot <span className="third-shot-hint">serving side</span>
                        </h3>
                        <div className="third-shot-grid">
                          {servingTeamPlayers.map((id) => (
                            <div className="player-panel" key={id}>
                              <div className="player-panel-name">{name(id)}</div>
                              <div className="player-panel-outcomes">
                                <button
                                  className="outcome-btn winner"
                                  aria-label={`Drop landed, ${name(id)}`}
                                  aria-pressed={picked(id, 'drop', true)}
                                  onClick={() => logThirdShot(id, 'drop', true)}
                                >
                                  <span>Drop <Icon name="check" size={18} className="icon-solo" /></span>
                                </button>
                                <button
                                  className="outcome-btn error"
                                  aria-label={`Drop missed, ${name(id)}`}
                                  aria-pressed={picked(id, 'drop', false)}
                                  onClick={() => logThirdShot(id, 'drop', false)}
                                >
                                  <span>Drop <Icon name="x" size={18} className="icon-solo" /></span>
                                </button>
                                <button
                                  className="outcome-btn neutral"
                                  aria-label={`Drive, ${name(id)}`}
                                  aria-pressed={picked(id, 'drive', null)}
                                  onClick={() => logThirdShot(id, 'drive', null)}
                                >
                                  <span><Icon name="drive" />Drive</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <h3 className="ending-group-title">{title}</h3>
                    <div className="ending-grid">
                      {endings.map((ending) => (
                        <button
                          key={ending.key}
                          className={`ending-btn ${tone}`}
                          onClick={() => pick(ending)}
                        >
                          <Icon name={ending.key} size={26} className="icon-solo" />
                          <span className="ending-label">
                            {ending.label}
                            {ending.by === 'server' && (
                              <span className="ending-auto">server</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>

      {picking && <ScorekeeperPicker matchId={matchId} onClose={() => setPicking(false)} />}

      {match.status === 'in_progress' && (
        <>
          <RallyLegend />

          {/* Kept well below the scoring buttons, where no rally tap can
              land on them by accident. */}
          <section className="match-controls" aria-label="Match">
            {isScorer && (match.recordedBy ?? me) === me && (
              <button onClick={() => setPicking(true)}>
                <Icon name="people" size={18} />
                Scorekeeper
              </button>
            )}
            <button className="end-early" onClick={handleEndEarly}>
              <Icon name="flag" size={18} />
              End match early
            </button>
            <button className="cancel-match" onClick={handleCancel}>
              <Icon name="x" size={18} />
              Cancel match
            </button>
          </section>
        </>
      )}

      {/* Nothing shows when the match has no video, or video is off here. */}
      {match.status === 'completed' && (
        <MatchVideo matchId={matchId} events={match.events} describe={(event) => describeEvent(event, name)} />
      )}

      {match.status === 'completed' && (
        <div className="void-controls">
          {match.voidedAt ? (
            <>
              <p className="voided-note">
                This match is voided — it is excluded from the exported data.
                {match.voidReason ? ` Reason: ${match.voidReason}` : ''}
              </p>
              <button onClick={() => unvoidMatch(matchId)}>Restore this match</button>
            </>
          ) : (
            <button className="void-btn" onClick={handleVoid}>
              Void this match (wrong pairing?)
            </button>
          )}
        </div>
      )}

      {match.status === 'completed' && (
        <section className="match-summary">
          <h3>Final stats</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Winners</th>
                  <th>Dink W</th>
                  <th>Errors</th>
                  <th>Dink E</th>
                  <th>Drops</th>
                  <th>Drives</th>
                </tr>
              </thead>
              <tbody>
                {players.map((id) => {
                  const s = derived.stats[id]
                  return (
                    <tr key={id}>
                      <td>{name(id)}</td>
                      <td>{s.clean_winners}</td>
                      <td>{s.dink_winners}</td>
                      <td>{s.unforced_errors}</td>
                      <td>{s.dink_errors}</td>
                      <td>
                        {s.drop_successes}/{s.drop_attempts}
                      </td>
                      <td>{s.drive_attempts}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* The finer split the two-tap scoring records. Only for
              players with at least one, since older matches have none. */}
          {players.some((id) => Object.keys(derived.endings[id] ?? {}).length > 0) && (
            <>
              <h3>How their rallies ended</h3>
              <ul className="endings-summary">
                {players.map((id) => {
                  const counts = derived.endings[id] ?? {}
                  const keys = Object.keys(counts)
                  if (keys.length === 0) return null
                  return (
                    <li key={id}>
                      <span className="endings-player">{name(id)}</span>
                      <span className="endings-chips">
                        {keys.map((key) => (
                          <span
                            key={key}
                            className={`endings-chip ${rallyEnding(key)?.outcome ?? ''}`}
                          >
                            {rallyEnding(key)?.label ?? key} &times;{counts[key]}
                          </span>
                        ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="history">
        <button
          className="collapsible-toggle"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
        >
          {showHistory ? '▾' : '▸'} History ({history.length})
        </button>
        {showHistory && (
          <ul className="history-list">
            {history.map((event) => (
              <li key={event.id}>{describeEvent(event, name)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default LiveMatch
