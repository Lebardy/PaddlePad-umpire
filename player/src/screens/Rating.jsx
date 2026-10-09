// ============================================================
// Your rating: your own points, then the two things the model did.
//
// It runs in order:
//
//   1  the player's rally points, and every kind of rally moving them --
//      worked out rally by rally in the API, never compared with anyone
//   2  what to work on: their most frequent faults, each with one tip
//   3  how they play: a playstyle found among the players closest to
//      their level, each word proven with numbers
//
// Step 1 shows whenever the player has five matches, whether or not
// the nightly run has rated them, and so does step 2. Step 3 needs that
// run.
//
// The player's skill group is one line inside the playstyle step -- the
// only place it matters. The pipeline's label for the group ("Group 3")
// is dropped from style names for the same reason; see lib/styleName.js.
//
// Each word in the style name shows this player's own number, the
// average of players with their style and their group's average, with
// an arrow and a short line saying which way the style leans. Nobody's
// individual numbers but their own; see server/src/playstyle.js.
//
// It never shows a ranking and never anyone else's score. Why is one
// tap away at the bottom.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchStanding } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'
import { navigate } from '../lib/router'
import { endingPhrase, namedLeaders } from '../lib/endingWords'
import { styleName } from '../lib/styleName'
import { MEASURES, hiddenStyleNote, styleShareLine, traitLine, verdictWay } from '../lib/styleProof'
import { faultsToWorkOn } from '../lib/faultTips'
import { RallyPointsHeadline, RallyProgress } from '../components/RallyRating'
import More from '../components/More'
import Collapsible from '../components/Collapsible'
import ShotProfile from '../components/ShotProfile'
import Icon from '../components/Icon'
import StyleEmblem, { TraitMark } from '../components/StyleEmblem'


// Said only where there IS a direction. Most of these measurements are
// style rather than quality -- the model works playstyles out
// separately from the rating, so "steady" is not a better way to play
// than "streaky" -- and a row that announced "neither is better" said
// nothing while taking up the space of something that did.
const DIRECTION = {
  higher: 'higher is better',
  lower: 'lower is better',
}

function showValue(value, as) {
  if (value === null || value === undefined) return '—'
  if (as === 'percent') return `${Math.round(value * 100)}%`
  if (as === 'ratio') return value.toFixed(2)
  if (as === 'swing-percent') return `±${Math.round(value * 100)}%`
  if (as === 'swing-per10') return `±${(value * 10).toFixed(1)}`
  return `±${value.toFixed(2)}`
}

// `number` only staggers the entrance; each step is marked by its icon.
// `lead` is drawn beside the value: the playstyle's emblem.
function Step({ number, icon, title, value, lead, children }) {
  return (
    <section className="step rise" style={{ '--i': number }} aria-label={title}>
      <div className="step-head">
        <span className="step-n"><Icon name={icon} size={18} /></span>
        <h2>{title}</h2>
      </div>
      {value && (
        <div className="step-lead">
          {lead}
          <p className="step-value">{value}</p>
        </div>
      )}
      {children}
    </section>
  )
}

function BackLink() {
  return (
    <button
      type="button"
      className="back-link"
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}
    >
      &larr; Back
    </button>
  )
}

// What the rows that are not the player's own endings are called.
const LEDGER_WORDS = {
  untagged: 'Your rallies with no ending recorded',
  partner: 'Rallies your partner ended',
  opponent_winner: 'Winning shots by your opponents',
  opponent_error: 'Mistakes by your opponents',
  match_result: 'Winning and losing matches',
}

function signed(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

// A row's count: matches for the match reward, rallies for the rest.
function countWords(row) {
  if (row.matches !== undefined) return `${row.matches} ${row.matches === 1 ? 'match' : 'matches'}`
  return `${row.rallies} ${row.rallies === 1 ? 'rally' : 'rallies'}`
}

// One or two endings tied for the most, in bold: "hitting out and
// hitting into the net".
function LeaderNames({ leaders }) {
  return leaders.map((row, i) => (
    <span key={row.ending}>
      {i > 0 && ' and '}
      <strong>{endingPhrase(row.ending).toLowerCase()}</strong>
    </span>
  ))
}

// "24 rallies, +31", or for two tied, "13 rallies each, +20 together".
function leaderNumbers(leaders) {
  if (leaders.length === 1) return `${countWords(leaders[0])}, ${signed(leaders[0].points)}`
  const together = leaders.reduce((sum, row) => sum + row.points, 0)
  return `${countWords(leaders[0])} each, ${signed(together)} together`
}

/**
 * A row with a bar growing left (lost points) or right (gained points)
 * from a centre line. Every row shares one scale, so the longest arm is
 * the thing that moved the number most.
 */
function PointsArm({ points, widest, label }) {
  const reach = widest > 0 ? Math.min(1, Math.abs(points) / widest) : 0
  return (
    <span className="part-scale" role="img" aria-label={label}>
      <span className="part-axis" />
      {points !== 0 && (
        <span
          className={`part-arm ${points < 0 ? 'is-behind' : 'is-ahead'}`}
          style={{ width: `${reach * 50}%` }}
        />
      )}
    </span>
  )
}

/**
 * Step 1: the player's own rally points, and the arithmetic behind them.
 *
 * Not a verdict in words: every rally that moved the number is in a row,
 * with how many rallies and how many points, and the rows add up exactly
 * to the distance from 1,500 (the server rounds them so they do). Closed
 * by default -- a long table under the headline was too much at once --
 * with the one-line answer and the total still showing while it is shut.
 */
function Score({ rallyRating }) {
  const won = namedLeaders(rallyRating.mostOften?.won)
  const lost = namedLeaders(rallyRating.mostOften?.lost)
  const rows = [...(rallyRating.breakdown ?? [])].sort((a, b) => b.points - a.points)
  const widest = Math.max(...rows.map((row) => Math.abs(row.points)), 0)
  const total = rallyRating.points - 1500

  return (
    <Step number={1} icon="gauge" title="PaddlePad Rating">
      <RallyPointsHeadline rallyRating={rallyRating} />

      {rows.length > 0 && (
        <div className="moving">
          {/* Fully folded: the page has four steps now, so closed it is one
              line, and the sentence opens with the table it sums up. */}
          <Collapsible title="What’s moving it">
            <p className="step-line">
              {/* The table's answer in words, only once there are enough
                  rallies with an ending to call it a habit. */}
              {(won || lost) && (
                <>
                  Of the rallies you ended, you{' '}
                  {won && <>won the most with <LeaderNames leaders={won} /> ({leaderNumbers(won)})</>}
                  {won && lost && ' and '}
                  {lost && <>lost the most with <LeaderNames leaders={lost} /> ({leaderNumbers(lost)})</>}
                  .{' '}
                </>
              )}
              Everything below comes to <strong>{signed(total)}</strong>.
            </p>
            <ul className="parts-list" aria-label="Where your PPR came from">
              {rows.map((row, i) => {
                const label = row.ending ? endingPhrase(row.ending) : LEDGER_WORDS[row.kind]
                return (
                  <li key={row.ending ?? row.kind} className="part collapsible-item" style={{ '--i': i }}>
                    <div className="part-head">
                      <span className="part-label">{label}</span>
                      <span className="part-values">
                        <span className="part-theirs">{countWords(row)} · </span>
                        <strong className={row.points > 0 ? 'is-up' : row.points < 0 ? 'is-down' : ''}>
                          {signed(row.points)}
                        </strong>
                      </span>
                    </div>
                    <PointsArm
                      points={row.points}
                      widest={widest}
                      label={`${label}: ${signed(row.points)} PPR over ${countWords(row)}`}
                    />
                  </li>
                )
              })}
            </ul>
            <p className="points-sum collapsible-item" style={{ '--i': rows.length }}>
              Adds up to <strong>{signed(total)}</strong>: from 1,500 to{' '}
              {rallyRating.points.toLocaleString()} PPR.
            </p>
          </Collapsible>
        </div>
      )}

      <More label="How is PPR worked out?">
        <p>
          Every rally is a small contest. Win it with a shot and you gain PPR;
          lose it with a mistake and you give some away. Beating a stronger side
          earns more than beating a weaker one.
        </p>
        <p>
          Winning the match counts too. The winning side gains PPR and the
          losing side gives the same amount up, shared equally between partners.
          Beating a side you were expected to lose to earns much more than
          beating one you were expected to beat.
        </p>
        <p>
          A game against someone new to PaddlePad counts for less for everyone
          else, until they have played five matches. So losing to a newcomer can
          cost you less than they gain, or nothing at all in their first game.
        </p>
        <p>
          The rally counts too when someone else ends it: your
          partner&rsquo;s shots and mistakes move your PPR a little, and your
          opponents&rsquo; winning shots and mistakes move it too. That is why
          those rows are in the list — without them it would not add up.
        </p>
        <p>
          Your PPR only changes when you play — never because someone else
          did.
        </p>
      </More>
    </Step>
  )
}

/**
 * Step 2: what to work on -- the faults the player makes most often, each
 * with one tip, and how many times. No points: this card is about habits
 * to change, and step 1 already shows what each one cost.
 *
 * Straight after step 1 because it is that card's "so what": the same
 * rows, the player's own most frequent faults, turned into something to
 * practise. It needs no nightly run, so it shows for any rated player.
 *
 * Waits for the same 20 rallies with an ending that "What's moving it"
 * waits for before naming a habit (mostOften is null until then): a tip
 * aimed at two unlucky rallies would be advice about nothing.
 */
function WorkOn({ rallyRating }) {
  const enough = Boolean(rallyRating.mostOften)
  const faults = enough ? faultsToWorkOn(rallyRating.breakdown) : []

  return (
    <Step number={2} icon="target" title="What to work on">
      {!enough ? (
        <p className="step-line">
          Tips appear once 20 of your rallies have been scored with how they
          ended — a few rallies can&rsquo;t show a habit.
        </p>
      ) : faults.length === 0 ? (
        <p className="step-line">None of these mistakes show up in your rallies yet.</p>
      ) : (
        <>
          <ol className="tips" aria-label="The mistakes you make most often">
            {faults.map((fault, i) => (
              <li key={fault.ending} className="tip rise" style={{ '--i': i }}>
                <span className="tip-rank" aria-hidden="true">{i + 1}</span>
                <div className="tip-body">
                  <div className="tip-head">
                    <span className="tip-name">{endingPhrase(fault.ending)}</span>
                    <span className="tip-cost">
                      <strong>{fault.rallies}</strong> {fault.rallies === 1 ? 'time' : 'times'}
                    </span>
                  </div>
                  <p className="tip-text">{fault.tip}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Step>
  )
}

/**
 * The proof rows gathered by word. Every adjective has one measurement;
 * the all-court noun arrives as two rows marked neutral (see
 * server/src/playstyle.js) and is shown as one word with both under it.
 */
function proofItems(rows) {
  const items = []
  for (const row of rows) {
    const last = items[items.length - 1]
    if (row.neutral && last?.neutral && last.label === row.label) last.rows.push(row)
    else items.push({ label: row.label, neutral: Boolean(row.neutral), rows: [row] })
  }
  return items
}

/**
 * The one sentence under "All-Court Player", naming only the habits that
 * have something recorded and saying which do not.
 */
function allCourtSentence(rows) {
  const shown = rows.filter((row) => row.you !== null).map((row) => MEASURES[row.feature]?.label ?? row.feature)
  const missing = rows.some((row) => row.feature === 'drop_preference_rate_mean' && row.you === null)
  if (shown.length === 0) {
    return 'All-court means your style doesn’t lean towards dropping or driving, or towards the net or power — there is nothing recorded yet to show it.'
  }
  return `Your style sits close to your group on ${shown.join(' and ')}, so it’s called all-court — your own numbers can lean one way${
    missing ? ', and no third shots are recorded yet to compare drops with drives' : ''
  }.`
}

/** One measurement: you, your style, your group and the other style, as bars. */
function ProofMeasure({ row, proof, word = null, withVerdict = false }) {
  const measure = MEASURES[row.feature] ?? {
    label: row.feature, as: 'ratio', better: 'neither',
  }
  // Every word is chosen from where the player's STYLE sits against their
  // group, so the style's bar is the one that proves it; the player's own
  // number stays first so they can see where they sit inside it.
  const hasStyle = row.style !== null && row.style !== undefined
  const bars = [
    { who: 'you', value: row.you, mine: true },
    ...(hasStyle ? [{ who: 'your style', value: row.style }] : []),
    { who: 'your group', value: row.group },
  ]
  // Bars are drawn against the biggest of them, so a row is read by
  // comparing its own bars and nothing else.
  const widest = Math.max(...bars.map((b) => Math.abs(b.value ?? 0)), 0.0001)

  // One short line, said as a direction, never a size: on staging the
  // style's number pointed the word's way for all 124 words, but most
  // gaps were small. No line when the numbers can't point (a style of two
  // has no average; see lib/styleProof.js).
  const line = traitLine(row, proof?.styleSize)
  const way = verdictWay(row, proof?.styleSize)

  return (
    <>
      <div className="proof-head">
        {word && <span className="proof-word"><TraitMark word={word} />{word}</span>}
        <span className="proof-measure">{measure.label}</span>
        {DIRECTION[measure.better] && (
          <span className="proof-better">{DIRECTION[measure.better]}</span>
        )}
      </div>

      {/* Nothing recorded is said, not drawn as an empty bar that would
          read as zero: no third shots logged is not "never drops". */}
      {row.you === null ? (
        <p className="proof-verdict">Nothing recorded for this yet.</p>
      ) : (
        <ul className="proof-bars">
          {bars.map((bar) => (
            <li key={bar.who} className={bar.mine ? 'is-you' : undefined}>
              <span className="proof-who">{bar.who}</span>
              <span className="proof-track">
                <span
                  className="proof-fill"
                  style={{ width: `${Math.round((Math.abs(bar.value ?? 0) / widest) * 100)}%` }}
                />
              </span>
              <span className="proof-number">{showValue(bar.value, measure.as)}</span>
            </li>
          ))}
        </ul>
      )}

      {withVerdict && word && row.you !== null && line && (
        <p className="proof-verdict">
          <Icon name={way === 'higher' ? 'arrowUp' : 'arrowDown'} size={15} />
          {line}
        </p>
      )}
    </>
  )
}

/**
 * Step 3: how the player plays, with the numbers that chose its words.
 *
 * The skill group's only job for a player is to say who their style is
 * compared with, so it is said here, in one line, where it is used.
 */
/** Who the style is compared with, and what that group is, on a tap. */
function ComparedWith({ band, styleSize }) {
  if (!band?.size) return null
  return (
    <>
      <p className="step-line">{styleShareLine(styleSize, band.size)}</p>
      <More label="Who are they?">
        <p>
          Everyone rated is first split into a few groups of players whose
          matches go in similar ways — how often they win points, make
          mistakes, land drops and so on. Yours has {band.size} players.
        </p>
        <p>
          Styles are then worked out inside each group, so a word like
          &ldquo;Steady&rdquo; means steady for players at your level, not
          compared with everyone. Your PPR doesn&rsquo;t decide which
          group you&rsquo;re in.
        </p>
      </More>
    </>
  )
}

function Playstyle({ standing, number }) {
  const { playstyle: proof, band } = standing
  const name = styleName(standing.playstyleArchetype, band?.name)

  if (!name) {
    return (
      <Step number={number} icon="sparkle" title="Your playstyle" value="Not worked out yet">
        <p className="step-line">
          Styles are worked out among the players closest to your level, and
          that needs at least three of them. There {band?.size === 1 || !band?.size ? 'is 1' : `are ${band.size}`} so far.
        </p>
      </Step>
    )
  }

  if (!proof) {
    return (
      <Step number={number} icon="sparkle" title="Your playstyle" value={name} lead={<StyleEmblem name={name} />}>
        <p className="step-line">
          This name comes from how players with your style compare with the
          players closest to your level. The measurements behind it weren&rsquo;t recorded for this
          run, so there is nothing to show beside it yet.
        </p>
      </Step>
    )
  }

  return (
    <Step number={number} icon="sparkle" title="Your playstyle" value={name} lead={<StyleEmblem name={name} />}>
      <ComparedWith band={band} styleSize={proof.styleSize} />

      <ul className="proof" aria-label="Why this name">
        {proofItems(proof.rows).map((item) =>
          item.neutral ? (
            // "All-Court Player": chosen because NEITHER habit stood out,
            // so both are shown under the one word, and the sentence
            // says that rather than "yours is less than".
            <li key={`neutral-${item.label}`} className="proof-row">
              <div className="proof-head">
                <span className="proof-word">{item.label}</span>
              </div>
              {/* A habit with nothing recorded gets no row of its own: it
                  has nothing to show, and a stray "nothing recorded" line
                  between two headings read as clutter. The one sentence
                  below says it instead. */}
              {item.rows.filter((row) => row.you !== null).map((row) => (
                <ProofMeasure key={row.feature} row={row} proof={proof} />
              ))}
              <p className="proof-verdict">{allCourtSentence(item.rows)}</p>
            </li>
          ) : (
            <li key={item.rows[0].feature} className="proof-row">
              <ProofMeasure row={item.rows[0]} proof={proof} word={item.label} withVerdict />
            </li>
          ),
        )}
      </ul>

      {hiddenStyleNote(proof.styleSize) && (
        <p className="step-line">{hiddenStyleNote(proof.styleSize)}</p>
      )}

      <More label="How this was worked out">
        <p>
          Inside your group, players are grouped again by how they play. Each
          word in the name is a measurement where players with your style sit
          furthest from your group&rsquo;s average — so the bars compare your
          style with your group, and your own number shows where you sit
          inside your style.
        </p>
        <p>
          Averages only, never anyone&rsquo;s own numbers but yours. A style with
          fewer than three players is never averaged at all.
        </p>
      </More>
    </Step>
  )
}

function Rating() {
  const { rating, rallyRating, summary } = usePlayerData()
  const [standing, setStanding] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchStanding({ signal: controller.signal })
      .then(setStanding)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [])

  const mlRated = standing?.state === 'rated' && rating?.state === 'rated'
  const rally = standing?.rallyRating ?? rallyRating

  return (
    <div className="standing">
      <BackLink />
      <h1>Your rating</h1>

      {error && <p className="error">{error}</p>}
      {!standing && !error && <p className="muted-inline">Loading…</p>}

      {/* Step 1 is always here, even before five matches, so steps 2
          and 3 -- which the nightly run can fill in on its own count --
          never appear without it. */}
      {standing && rally?.state === 'not_enough_matches' && (
        <Step number={1} icon="gauge" title="PaddlePad Rating">
          <RallyProgress rallyRating={rally} />
        </Step>
      )}

      {standing && rally?.state === 'rated' && (
        <>
          <Score rallyRating={rally} />
          <WorkOn rallyRating={rally} />
        </>
      )}

      {/* Third after the two rally cards; second when the player is not
          rated on points yet but the nightly run has a style for them. */}
      {mlRated && <Playstyle standing={standing} number={rally?.state === 'rated' ? 3 : 2} />}

      {/* Moved here from the Overview: where your points come from sits
          beside the playstyle that already talks about drops. */}
      {standing && rally && summary && (
        <Step number={(rally.state === 'rated' ? 2 : 1) + (mlRated ? 1 : 0) + 1} icon="trophy" title="How you win points">
          <ShotProfile summary={summary} />
        </Step>
      )}
    </div>
  )
}

export default Rating
