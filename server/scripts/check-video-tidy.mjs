#!/usr/bin/env node
// ============================================================
// Which files in the bucket nobody owns. No database, no network.
//
//   node server/scripts/check-video-tidy.mjs
//
// The daily clean-up deletes a file that no video row names, but only
// once it is a day old: a phone asks for its form, gets a row with the
// file's name, and may take a long while to finish sending.
// ============================================================

import { KEEP_DAYS, orphanKeys, tidyVideos } from '../src/video-tidy.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const NOW = Date.parse('2026-10-11T12:00:00Z')
const hours = (n) => NOW - n * 3600 * 1000
const files = [
  { key: 'videos/m1/a.mp4', bytes: 10, modifiedMs: hours(48) },   // named by a row
  { key: 'videos/m2/b.mp4', bytes: 10, modifiedMs: hours(48) },   // nobody's, two days old
  { key: 'videos/m3/c.mp4', bytes: 10, modifiedMs: hours(2) },    // nobody's, but new
  { key: 'videos/m4/d.mp4', bytes: 10, modifiedMs: hours(24) },   // nobody's, exactly a day
  { key: 'videos/m5/e.mp4', bytes: 10, modifiedMs: Number.NaN },  // no readable time
]

check('videos are kept 60 days', KEEP_DAYS, 60)
check('only the old file nobody names', orphanKeys(files, ['videos/m1/a.mp4'], NOW), ['videos/m2/b.mp4'])
check('a set works as well as a list', orphanKeys(files, new Set(['videos/m1/a.mp4', 'videos/m2/b.mp4']), NOW), [])
check('with no rows at all, every old file', orphanKeys(files, [], NOW), ['videos/m1/a.mp4', 'videos/m2/b.mp4'])
check('an empty bucket', orphanKeys([], ['videos/m1/a.mp4'], NOW), [])

// One file the bucket refuses to delete must not stop the others.
const config = { bucket: 'b', region: 'r', keyId: 'k', secret: 's', host: 'b.example.test', origin: 'https://b.example.test' }
const realFetch = globalThis.fetch
globalThis.fetch = async (url, { method }) => {
  if (method === 'DELETE') return new Response(null, { status: String(url).includes('bad') ? 500 : 204 })
  return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 })
}
const removedRows = []
const stubQuery = async (text, params) => {
  if (text.startsWith('SELECT match_id')) {
    return { rows: ['one', 'bad', 'three'].map((name) => ({ match_id: name, file_key: `videos/${name}/v.mp4`, state: 'ready' })) }
  }
  if (text.startsWith('DELETE')) removedRows.push(params[0])
  return { rows: [] }
}
const realError = console.error
console.error = () => {}
let result
try {
  result = await tidyVideos({ query: stubQuery, config, now: new Date(NOW) })
} catch (error) {
  result = `threw: ${error.message}`
} finally {
  globalThis.fetch = realFetch
  console.error = realError
}
check('a refused delete does not end the run', result, { expired: 2, unfinished: 0, orphans: 0 })
check('only the good rows were removed', removedRows, ['one', 'three'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
