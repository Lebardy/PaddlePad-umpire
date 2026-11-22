#!/usr/bin/env node
// The name a saved match video gets. No network.
//   node server/scripts/check-video-name.mjs
import { displaySurname, videoFileName } from '../src/video-name.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('doubles: surnames, side A first',
  videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Ana Cruz', 'Ben Reyes'], sideB: ['Paolo Sy', 'Rico Mendoza'] }),
  'PaddlePad 2026-11-20 Cruz-Reyes vs Sy-Mendoza')
check('singles',
  videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Ana Cruz'], sideB: ['Paolo Sy'] }),
  'PaddlePad 2026-11-20 Cruz vs Sy')
check('the day is the Philippines\' day (late evening UTC is the next morning there)',
  videoFileName({ startedAt: '2026-11-20T17:30:00Z', sideA: ['Ana Cruz'], sideB: ['Paolo Sy'] }),
  'PaddlePad 2026-11-21 Cruz vs Sy')
check('marks on letters are dropped, so every phone can name the file',
  videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Niño Peña'], sideB: ['José Dela Cruz'] }),
  'PaddlePad 2026-11-20 Pena vs Dela Cruz')
check('a label on screen keeps accents and punctuation', [displaySurname('Niño Peña'), displaySurname("Liam O'Brien"), displaySurname('Ramon Tolentino Jr.'), displaySurname('José de los Santos')], ['Peña', 'O\'Brien', 'Tolentino', 'de los Santos'])
const named = (a, b = 'Paolo Sy') => videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: [a], sideB: [b] })
check('a surname keeps its particles', named('Juan Dela Cruz'), 'PaddlePad 2026-11-20 Dela Cruz vs Sy')
check('de los is kept', named('José de los Santos'), 'PaddlePad 2026-11-20 de los Santos vs Sy')
check('a trailing Jr. is dropped', named('Ramon Tolentino Jr.'), 'PaddlePad 2026-11-20 Tolentino vs Sy')
check('a trailing III is dropped', named('Mark Santos III'), 'PaddlePad 2026-11-20 Santos vs Sy')
check('a plain surname is as before', named('Ana Cruz'), 'PaddlePad 2026-11-20 Cruz vs Sy')
check('a multi-word surname keeps its spaces in a pair', videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Ana Dela Cruz', 'Ben Reyes'], sideB: ['Paolo Sy'] }), 'PaddlePad 2026-11-20 Dela Cruz-Reyes vs Sy')
check('a name with only one word is used whole',
  videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Ana'], sideB: ['Sy'] }),
  'PaddlePad 2026-11-20 Ana vs Sy')
check('quotes, slashes and the like are dropped',
  videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Ana "AC" O\'Neil/Cruz'], sideB: ['Paolo Sy'] }),
  'PaddlePad 2026-11-20 ONeilCruz vs Sy')
check('a player with no name left (deleted) is skipped',
  videoFileName({ startedAt: '2026-11-20T02:00:00Z', sideA: ['Ana Cruz', ''], sideB: ['Paolo Sy'] }),
  'PaddlePad 2026-11-20 Cruz vs Sy')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
