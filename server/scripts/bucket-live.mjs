#!/usr/bin/env node
// ============================================================
// The bucket signer against a real bucket. Not part of `pnpm test`.
//
//   node --env-file=.env.video scripts/bucket-live.mjs
//
// Sends a 1 KB file with a signed form the way a browser would, reads
// it back, and removes it. Prints no key and no link.
// ============================================================

import { bucketConfig, deleteFile, fileSize, listFiles, signedReadUrl, signedUploadForm } from '../src/bucket.js'

const config = bucketConfig()
if (!config) { console.log('The five VIDEO_BUCKET settings are not all set'); process.exit(1) }

let fail = 0
const check = (label, ok, detail = '') => { if (!ok) fail += 1; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`) }
const key = `videos/live-check/${Date.now()}.mp4`
const bytes = new Uint8Array(1024).map((_, i) => i % 251)

async function post(form, body, type = 'video/mp4') {
  const data = new FormData()
  for (const [name, value] of Object.entries(form.fields)) data.append(name, name === 'Content-Type' ? type : value)
  data.append('file', new Blob([body], { type }), 'clip.mp4')
  const response = await fetch(form.url, { method: 'POST', body: data })
  return response.status
}

try {
  check('no file there yet', (await fileSize(config, key)) === null)
  check('a form signed for 1024 bytes refuses 2000', (await post(signedUploadForm(config, key, { bytes: 1024 }), new Uint8Array(2000))) >= 400)
  check('and refuses another type', (await post(signedUploadForm(config, key, { bytes: 1024 }), bytes, 'text/plain')) >= 400)
  check('nothing was stored by the refusals', (await fileSize(config, key)) === null)
  const sent = await post(signedUploadForm(config, key, { bytes: 1024 }), bytes)
  check('the right file is accepted', sent >= 200 && sent < 300, String(sent))
  check('its size is 1024', (await fileSize(config, key)) === 1024)
  const listed = await listFiles(config, 'videos/live-check/')
  check('the listing finds it, with its size and a time', listed.some((f) => f.key === key && f.bytes === 1024 && f.modifiedMs > Date.now() - 600_000),
    JSON.stringify(listed.map((f) => [f.bytes, f.modifiedMs])))
  const read = await fetch(signedReadUrl(config, key, { seconds: 60 }))
  const back = new Uint8Array(await read.arrayBuffer())
  check('a signed link reads it back the same', read.status === 200 && back.length === 1024 && back.every((b, i) => b === bytes[i]), String(read.status))
  const part = await fetch(signedReadUrl(config, key, { seconds: 60 }), { headers: { Range: 'bytes=100-199' } })
  check('and reads a part of it', part.status === 206 && (await part.arrayBuffer()).byteLength === 100, String(part.status))
  check('no link, no file', (await fetch(`${config.origin}/${key}`)).status === 403)
  check('a link signed with another secret is refused',
    (await fetch(signedReadUrl({ ...config, secret: 'not-the-secret' }, key, { seconds: 60 }))).status === 403)
} finally {
  await deleteFile(config, key)
  check('deleted', (await fileSize(config, key)) === null)
  await deleteFile(config, key)
  check('deleting it again is fine', true)
}
console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
