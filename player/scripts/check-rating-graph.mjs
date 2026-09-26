#!/usr/bin/env node
// ============================================================
// The rating graph's steps, headline, high and low.
//
//   node player/scripts/check-rating-graph.mjs
//
// Run in Manila time, where PaddlePad is played: a match late at night
// UTC is the next morning there, and belongs to that day.
// ============================================================

process.env.TZ = 'Asia/Manila'

const { START, changeWords, graphView, weekView } = await import('../src/lib/ratingGraph.js')

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const now = Date.parse('2026-09-27T04:00:00Z') // noon in Manila
const DAY = 86_400_000
/** A history from [daysAgo, points] pairs, oldest first. */
const history = (...pairs) => pairs.map(([daysAgo, points]) => ({ at: new Date(now - daysAgo * DAY).toISOString(), points }))
const values = (view) => view.points.map((point) => point.value)

// ---- Week and Month ----
{
  const matches = [
    ...history([10, 1490]),
    { at: '2026-09-25T15:30:00Z', points: 1495 }, // 23:30 on 25 Sep in Manila
    { at: '2026-09-25T16:30:00Z', points: 1502 }, // 00:30 on 26 Sep in Manila
    { at: '2026-09-26T02:00:00Z', points: 1498 }, // later on 26 Sep
  ]
  const week = graphView(matches, 'week', now)
  check('a week starts from where they stood seven days ago', week.points[0].value, 1490)
  check('then one step per day played, in local time', values(week), [1490, 1495, 1498])
  check('each step carries that day\'s change', week.points.map((p) => p.change), [undefined, 5, 3])
  check('the headline is the change over the span', week.headline, { change: 8, words: 'in the last 7 days' })
  check('the overview card draws the same line from what the server sends',
    values(weekView({ from: 1490, matches: matches.slice(1) }, now)), values(week))

  check('a week with no matches is empty',
    graphView(history([9, 1510]), 'week', now).empty, true)
  check('the overview card says so too', weekView({ from: 1510, matches: [] }, now).empty, true)

}

// ---- Month: one step per calendar month, since the first match ----
{
  const matches = [
    { at: '2026-06-10T04:00:00Z', points: 1490 },
    { at: '2026-06-20T04:00:00Z', points: 1484 },
    // Nothing in July.
    { at: '2026-08-02T04:00:00Z', points: 1470 },
    { at: '2026-08-31T15:30:00Z', points: 1478 }, // 23:30 on 31 Aug in Manila
    { at: '2026-08-31T16:30:00Z', points: 1486 }, // 00:30 on 1 Sep in Manila
    { at: '2026-09-20T04:00:00Z', points: 1495 },
  ]
  const month = graphView(matches, 'month', now)
  check('month starts at 1,500, then where each month played closed', values(month), [1500, 1484, 1478, 1495])
  check('months are the reader\'s own: 00:30 on 1 Sep counts in September',
    month.points.slice(1).map((p) => p.at.getMonth()), [5, 7, 8])
  check('each month carries its combined change', month.points.map((p) => p.change), [undefined, -16, -6, 17])
  check('a month with no match is not a step', month.points.length, 4)
  check('the headline is the latest month\'s change', month.headline, { change: 17, words: 'in September' })
  check('the 1,500 line shows, as on All', [month.startLine, month.step, month.ticks], [true, 'month', 'months'])
  check('month never comes back empty, even after a quiet month',
    graphView(history([45, 1510]), 'month', now).empty, undefined)
  const lastYear = graphView([{ at: '2025-12-05T04:00:00Z', points: 1520 }], 'month', now)
  check('a latest month from another year says the year', lastYear.headline.words, 'in December 2025')
}

// ---- All ----
{
  const climb = graphView(history([40, 1480], [30, 1466], [20, 1490], [1, 1511]), 'all', now)
  check('all starts at 1,500 on the day of their first match',
    [climb.points[0].value, climb.startedAt.toISOString()], [START, new Date(now - 40 * DAY).toISOString()])
  check('one step per match', [values(climb), climb.step], [[1500, 1480, 1466, 1490, 1511], 'match'])
  check('the headline counts the climb from their lowest', climb.headline, { change: 45, words: 'since your lowest' })

  const sinking = graphView(history([40, 1490], [1, 1466]), 'all', now)
  check('at their lowest now, it counts from the first match', sinking.headline, { change: -34, words: 'since your first match' })

  const rising = graphView(history([40, 1504], [1, 1511]), 'all', now)
  check('when the lowest was the 1,500 start, it counts from the first match', rising.headline, { change: 11, words: 'since your first match' })

  const long = Array.from({ length: 60 }, (_, i) => ({ at: new Date(now - (60 - i) * DAY / 3).toISOString(), points: 1500 + i }))
  const everyMatch = graphView(long, 'all', now)
  check('a long history is still one step per match, several a day included',
    [everyMatch.step, everyMatch.points.length], ['match', 61])
}

// ---- The words over the graph ----
check('a climb reads with its arrow and PPR',
  changeWords({ change: 45, words: 'since your lowest' }), '▲ +45 PPR since your lowest')
check('a drop uses a true minus sign',
  changeWords({ change: -34, words: 'since your first match' }), '▼ −34 PPR since your first match')
check('no change says level', changeWords({ change: 0, words: 'in the last 7 days' }), 'Level in the last 7 days')

// ---- High and low symbols ----
{
  const mixed = graphView(history([5, 1520], [4, 1480], [2, 1500]), 'week', now)
  check('high and low read off the line as drawn', [mixed.highest, mixed.lowest], [1520, 1480])
  check('their symbols sit on those steps', [mixed.highIndex, mixed.lowIndex], [1, 2])

  const best = graphView(history([5, 1490], [2, 1530]), 'week', now)
  check('no high symbol when the high is now', best.highIndex, null)

  const flat = graphView(history([9, 1500], [2, 1500]), 'week', now)
  check('no symbols on a line that never moved', [flat.highIndex, flat.lowIndex], [null, null])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
