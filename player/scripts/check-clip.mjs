#!/usr/bin/env node
// ============================================================
// Cutting clips out of a repacked match video (src/lib/clipMp4.js).
//
//   node player/scripts/check-clip.mjs
//
// A made-up ordinary MP4 is cut and the result's tables are read back:
// each sample's bytes are its own mark, so a table pointing at the
// wrong place shows. When the trial's real phone recordings are on this
// machine (not in git) and ffprobe is installed, each is repacked with
// the app's own repack, cut, and ffprobe confirms the clips open, start
// on a key picture, last as long as asked and keep sound in step.
// Set CLIP_RECORDINGS to the recordings folder if it is not at the
// usual place beside this repo.
// ============================================================

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, openAsBlob, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cutClips, readIndex } from '../src/lib/clipMp4.js'
import { flattenMp4 } from '../src/lib/flattenMp4.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)
const reader = (blob) => async (from, to) => new Uint8Array(await blob.slice(from, to).arrayBuffer())

// ---- a made-up ordinary MP4: 10 s of video at 10 a second (key every 2 s), sound at 50 a second ----
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
const box = (kind, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(kind, 'latin1'), body]) }
const full = (kind, version, flags, ...parts) => box(kind, u32(version * 2 ** 24 + flags), ...parts)

function madeUp() {
  // Samples interleaved one second at a time: 10 pictures then 50 sounds. Each sample is 6 bytes: track letter, then its index.
  const mark = (letter, i) => Buffer.from(`${letter}${String(i).padStart(5, '0')}`, 'latin1')
  const video = []; const sound = []; const data = []
  for (let s = 0; s < 10; s++) {
    for (let i = s * 10; i < s * 10 + 10; i++) { video.push({ i, key: i % 20 === 0 }); data.push(['v', i]) }
    for (let i = s * 50; i < s * 50 + 50; i++) { sound.push({ i }); data.push(['s', i]) }
  }
  const trak = (id, handler, scale, delta, samples, keys) => box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(10 * 1000), Buffer.alloc(60)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(samples.length * delta), u32(0)),
      full('hdlr', 0, 0, u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12), Buffer.from('x\0', 'latin1')),
      box('minf',
        handler === 'vide' ? full('vmhd', 0, 1, Buffer.alloc(8)) : full('smhd', 0, 0, Buffer.alloc(4)),
        box('stbl',
          full('stsd', 0, 0, u32(0)),
          full('stts', 0, 0, u32(1), u32(samples.length), u32(delta)),
          ...(keys ? [full('stss', 0, 0, u32(keys.length), ...keys.map((k) => u32(k)))] : []),
          // One chunk per sample keeps the made-up file simple; positions are filled in below.
          full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
          full('stsz', 0, 0, u32(6), u32(samples.length)),
          full('stco', 0, 0, u32(samples.length), ...samples.map(() => u32(0)))))))
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomiso2mp41', 'latin1'))
  const build = (positions) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(10 * 1000), Buffer.alloc(80)),
    patch(trak(1, 'vide', 1000, 100, video, video.filter((v) => v.key).map((v) => v.i + 1)), positions.v),
    patch(trak(2, 'soun', 1000, 20, sound), positions.s))
  // Write the real chunk positions into a trak's stco.
  function patch(t, list) {
    const at = t.indexOf(Buffer.from('stco', 'latin1')) + 12
    list.forEach((p, n) => t.writeUInt32BE(p, at + n * 4))
    return t
  }
  const empty = { v: video.map(() => 0), s: sound.map(() => 0) }
  const moovSize = build(empty).length
  const dataStart = ftyp.length + moovSize + 8
  const positions = { v: [], s: [] }
  data.forEach(([letter], n) => positions[letter].push(dataStart + n * 6))
  const moov = build(positions)
  const mdat = box('mdat', ...data.map(([letter, i]) => mark(letter, i)))
  return new Blob([ftyp, moov, mdat], { type: 'video/mp4' })
}

// Reads a cut file back: per track, each sample's 6-byte mark, in order, and whether it is key.
async function marksOf(blob) {
  const read = reader(blob)
  const index = await readIndex(read)
  const out = {}
  for (const t of index.tracks) {
    const marks = []
    for (let n = 0; n < t.sizes.length; n++) {
      marks.push(Buffer.from(await read(t.positions[n], t.positions[n] + t.sizes[n])).toString('latin1'))
    }
    out[t.handler] = { marks, keys: t.keys, times: t.times, scale: t.scale }
  }
  return out
}

section('a made-up video')
{
  const source = madeUp()
  const read = reader(source)
  const index = await readIndex(read)
  check('both tracks are found', index.tracks.map((t) => t.handler), ['vide', 'soun'])
  check('100 pictures and 500 sounds', index.tracks.map((t) => t.sizes.length), [100, 500])

  const one = await marksOf(await cutClips(read, index, [{ start: 3, end: 5 }]))
  check('a clip from 3 s starts on the key picture at 2 s', one.vide.marks[0], 'v00020')
  check('and ends with the last picture before 5 s', one.vide.marks.at(-1), 'v00049')
  check('its first picture is key', one.vide.keys[0], true)
  check('its sound covers the same 2–5 s', [one.soun.marks[0], one.soun.marks.at(-1)], ['s00100', 's00249'])
  check('its times start at 0', [one.vide.times[0], one.soun.times[0]], [0, 0])

  const start = await marksOf(await cutClips(read, index, [{ start: 0, end: 1 }]))
  check('a clip at the very start', [start.vide.marks[0], start.vide.marks.at(-1)], ['v00000', 'v00009'])
  const end = await marksOf(await cutClips(read, index, [{ start: 9, end: 30 }]))
  check('a clip past the end stops at the last picture', [end.vide.marks[0], end.vide.marks.at(-1)], ['v00080', 'v00099'])

  const reel = await marksOf(await cutClips(read, index, [{ start: 0, end: 1 }, { start: 4, end: 5 }, { start: 8, end: 9 }]))
  check('a reel of three keeps them in order', reel.vide.marks.filter((m, n) => n === 0 || reel.vide.keys[n]), ['v00000', 'v00040', 'v00080'])
  check('a reel has each clip\'s pictures', reel.vide.marks.length, 10 + 10 + 10)
  check('its times run on with no gap', reel.vide.times.slice(9, 12), [900, 1000, 1100])

  let progress = []
  await cutClips(read, index, [{ start: 0, end: 1 }, { start: 4, end: 5 }], (f) => progress.push(f))
  check('progress is told after each clip', progress, [0.5, 1])

  let refused = null
  try { await readIndex(reader(new Blob([Buffer.from('not a video at all, not even close')]))) } catch (e) { refused = e.message }
  check('a file that is not a repacked video is refused', typeof refused, 'string')
}

// ---- the trial's real phone recordings, when present ----
// Beside this repo's own folder first, then the folder named by CLIP_RECORDINGS (a worktree has no copy).
const own = new URL('../../.superpowers/sdd/2026-10-10-video/recordings/', import.meta.url)
const names = ['phone-1080p-3min-last-piece-no-sound.mp4', 'phone-720p-4min.mp4']
const folder = names.every((n) => existsSync(new URL(n, own))) || !process.env.CLIP_RECORDINGS
  ? own
  : pathToFileURL(join(process.env.CLIP_RECORDINGS, '/'))
const real = names.map((n) => new URL(n, folder))
let probe = true
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }) } catch { probe = false }
if (!probe || !real.every((u) => existsSync(u))) {
  console.log('\nthe real recordings or ffprobe are not on this machine: skipped')
} else {
  const out = mkdtempSync(join(tmpdir(), 'clip-'))
  const ff = (file, ...args) => execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8' })
  for (const url of real) {
    section(url.pathname.split('/').pop())
    const { blob } = await flattenMp4(await openAsBlob(url))
    const read = reader(blob)
    const index = await readIndex(read)
    for (const [label, clips, longest] of [
      ['a clip of 16 s from 30 s', [{ start: 30, end: 46 }], 16 + 4.3],
      ['a clip at the very start', [{ start: 0, end: 10 }], 10 + 0.1],
      ['a clip at the very end', [{ start: 160, end: 400 }], 1e9],
      ['a reel of three', [{ start: 20, end: 36 }, { start: 60, end: 76 }, { start: 100, end: 116 }], 48 + 3 * 4.3],
    ]) {
      const file = join(out, `${label.replace(/\W+/g, '-')}.mp4`)
      writeFileSync(file, Buffer.from(await (await cutClips(read, index, clips)).arrayBuffer()))
      const streams = JSON.parse(ff(file, '-show_entries', 'stream=codec_type,start_time,duration')).streams
      const video = streams.find((s) => s.codec_type === 'video'); const sound = streams.find((s) => s.codec_type === 'audio')
      const asked = clips.reduce((n, c) => n + Math.min(c.end, index.seconds) - c.start, 0)
      check(`${label}: opens with a picture and a sound track`, Boolean(video && sound), true)
      check(`${label}: lasts at least what was asked and not much more`, Number(video.duration) >= asked - 0.2 && Number(video.duration) <= longest, true)
      check(`${label}: sound starts with the picture`, Math.abs(Number(video.start_time) - Number(sound.start_time)) < 0.1, true)
      const first = JSON.parse(ff(file, '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'frame=key_frame')).frames[0]
      check(`${label}: starts on a key picture`, first?.key_frame, 1)
      // A full decode proves the bytes are where the tables say.
      let clean = true
      try { execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { stdio: 'pipe' }) } catch { clean = false }
      check(`${label}: decodes from start to end without an error`, clean, true)
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
