#!/usr/bin/env node
// ============================================================
// What the server accepts as a facility logo.
//
//   node server/scripts/check-logo-rules.mjs
//
// The admin's browser shrinks a picture before sending it, but the
// server must not trust that: it checks the bytes really start like a
// PNG, JPEG or WebP, that both sizes agree, and that neither is too big.
// ============================================================

import {
  LOGO_FULL_MAX_BYTES, LOGO_SMALL_MAX_BYTES, readLogoUpload,
} from '../src/facility-rules.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP')])
/** A picture of `size` bytes that starts the way `head` says. */
const bytes = (head, size = 200) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)])
const dataUrl = (type, buf) => `data:${type};base64,${buf.toString('base64')}`
const upload = (type, full, small = full) => ({ full: dataUrl(type, full), small: dataUrl(type, small) })

for (const [type, head] of [['image/png', PNG], ['image/jpeg', JPEG], ['image/webp', WEBP]]) {
  const read = readLogoUpload(upload(type, bytes(head, 5000), bytes(head, 900)))
  check(`a ${type} is accepted`, [read.error, read.values?.mimeType, read.values?.full.length, read.values?.small.length],
    [undefined, type, 5000, 900])
}

check('text labelled as a PNG is refused',
  readLogoUpload(upload('image/png', Buffer.from('hello, this is not a picture'))).error, "That file isn't a picture")
check('a JPEG labelled as a PNG is refused',
  readLogoUpload(upload('image/png', bytes(JPEG))).error, "That file isn't a picture")
check('a GIF is refused',
  readLogoUpload(upload('image/gif', bytes(Buffer.from('GIF89a')))).error, 'Use a PNG, JPEG or WebP picture')
check('the two sizes must be the same kind',
  readLogoUpload({ full: dataUrl('image/png', bytes(PNG)), small: dataUrl('image/webp', bytes(WEBP)) }).error,
  'Use a PNG, JPEG or WebP picture')
check('a missing small version is refused',
  readLogoUpload({ full: dataUrl('image/png', bytes(PNG)) }).error, "That file isn't a picture")
check('nothing at all is refused', readLogoUpload(undefined).error, "That file isn't a picture")
check('not a data address is refused',
  readLogoUpload({ full: 'https://example.com/a.png', small: 'x' }).error, "That file isn't a picture")
check('a full picture at the limit is accepted',
  readLogoUpload(upload('image/png', bytes(PNG, LOGO_FULL_MAX_BYTES), bytes(PNG))).error, undefined)
check('a full picture one byte over is refused',
  readLogoUpload(upload('image/png', bytes(PNG, LOGO_FULL_MAX_BYTES + 1), bytes(PNG))).error, 'That picture is too large')
check('a small picture one byte over is refused',
  readLogoUpload(upload('image/png', bytes(PNG), bytes(PNG, LOGO_SMALL_MAX_BYTES + 1))).error, 'That picture is too large')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
