#!/usr/bin/env node
// ============================================================
// The player app shares no code with the umpire app (each is uploaded
// to Railway from its own folder), so it carries copies of the camera's
// helpers. A fix made in one copy and not the other would film or
// repack differently in the two apps: this fails until they match.
//
//   node scripts/check-video-copies.mjs
// ============================================================

import { readFileSync } from 'node:fs'

let fail = 0
for (const name of ['flattenMp4.js', 'videoClock.js', 'videoUpload.js', 'videoSpool.js']) {
  const read = (path) => { try { return readFileSync(new URL(path, import.meta.url), 'utf8') } catch { return null } }
  const ours = read(`../src/lib/${name}`)
  const theirs = read(`../player/src/lib/${name}`)
  const ok = ours !== null && ours === theirs
  if (!ok) fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} player/src/lib/${name} is src/lib/${name}, byte for byte${ok ? '' : theirs === null ? '   (the copy is missing)' : '   (they differ: copy the umpire app\'s file over it, or make the same change in both)'}`)
}
console.log(`\n${4 - fail} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
