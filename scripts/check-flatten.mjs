#!/usr/bin/env node
// ============================================================
// The repack (src/lib/flattenMp4.js). No browser, no network.
//
//   node scripts/check-flatten.mjs
//
// Builds small recordings shaped the way a browser writes them, runs
// the repack, then reads the result's tables back and checks that every
// sample's bytes are where the tables say and that the times add up.
// The made-up recordings include the two shapes that broke the trial:
// a last piece holding a picture and no sound, and a recording cut off
// part-way through its last piece.
//
// When the trial's real recordings are on this machine (they are not in
// git), the repack of each must be byte for byte the file the trial's
// Python prototype made, which is the one that was watched and jumped
// in on the owner's phone, in Chrome and in Firefox.
// ============================================================

import { createHash } from 'node:crypto'
import { existsSync, openAsBlob } from 'node:fs'
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

// ---- writing a recording the way a browser does ----
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
const box = (kind, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(kind, 'latin1'), body]) }
const full = (kind, version, flags, ...parts) => box(kind, u32(version * 2 ** 24 + flags), ...parts)
const VIDEO = { id: 1, handler: 'vide', scale: 30000, restFlags: 0x01010000 }
const SOUND = { id: 2, handler: 'soun', scale: 48000, restFlags: 0x02000000 }
const KEY_FLAGS = 0x02000000

const trak = (t) => box('trak',
  full('tkhd', 1, 3, u64(0), u64(0), u32(t.id), u32(0), u64(0), Buffer.alloc(60)),
  box('mdia',
    full('mdhd', 1, 0, u64(0), u64(0), u32(t.scale), u64(0), u32(0)),
    full('hdlr', 0, 0, u32(0), Buffer.from(t.handler, 'latin1'), Buffer.alloc(12), Buffer.from('x\0', 'latin1')),
    box('minf',
      t.handler === 'vide' ? full('vmhd', 0, 1, Buffer.alloc(8)) : full('smhd', 0, 0, Buffer.alloc(4)),
      box('stbl', full('stsd', 0, 0, u32(0)), full('stts', 0, 0, u32(0)), full('stsc', 0, 0, u32(0)), full('stsz', 0, 0, u32(0), u32(0)), full('stco', 0, 0, u32(0))))))

const header = ({ fragmented = true } = {}) => Buffer.concat([
  box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomiso6mp41', 'latin1')),
  box('moov',
    full('mvhd', 1, 0, u64(0), u64(0), u32(1000), u64(0), Buffer.alloc(80)),
    trak(VIDEO), trak(SOUND),
    ...(fragmented ? [box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)), full('trex', 0, 0, u32(2), u32(1), u32(0), u32(0), u32(0)))] : [])),
])

// Each sample's bytes are its own mark, so a table pointing at the wrong place shows.
const mark = (track, n, size) => Buffer.alloc(size, (track * 100 + n) % 251)

/** One piece: `runs` is [{ track, time, samples: [{ duration, size }], firstNumber }]. */
function piece(sequence, runs) {
  const build = (offsets) => box('moof', full('mfhd', 0, 0, u32(sequence)), ...runs.map((run, i) => box('traf',
    full('tfhd', 0, 0x020020, u32(run.track.id), u32(run.track.restFlags)),
    full('tfdt', 1, 0, u64(run.time)),
    run.track === VIDEO
      ? full('trun', 1, 0x305, u32(run.samples.length), u32(offsets[i]), u32(KEY_FLAGS), ...run.samples.flatMap((s) => [u32(s.duration), u32(s.size)]))
      : full('trun', 1, 0x301, u32(run.samples.length), u32(offsets[i]), ...run.samples.flatMap((s) => [u32(s.duration), u32(s.size)])))))
  const moofSize = build(runs.map(() => 0)).length
  let at = moofSize + 8
  const offsets = runs.map((run) => { const here = at; at += run.samples.reduce((n, s) => n + s.size, 0); return here })
  const data = Buffer.concat(runs.flatMap((run) => run.samples.map((s, n) => mark(run.track.id, run.firstNumber + n, s.size))))
  return Buffer.concat([build(offsets), box('mdat', data)])
}
const samples = (count, duration, size) => Array.from({ length: count }, (_, n) => ({ duration, size: size + n }))

// ---- reading an ordinary file's tables back ----
function boxesIn(buf, start, end) {
  const out = []
  for (let pos = start; pos + 8 <= end;) {
    let size = buf.readUInt32BE(pos); let head = 8
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); head = 16 }
    out.push({ kind: buf.toString('latin1', pos + 4, pos + 8), pos, size, head })
    pos += size
  }
  return out
}
const child = (buf, parent, kind) => boxesIn(buf, parent.pos + parent.head, parent.pos + parent.size).find((b) => b.kind === kind)
function readBack(buf) {
  const top = boxesIn(buf, 0, buf.length)
  const moov = top.find((b) => b.kind === 'moov')
  const tracks = {}
  for (const t of boxesIn(buf, moov.pos + 8, moov.pos + moov.size).filter((b) => b.kind === 'trak')) {
    const tkhd = child(buf, t, 'tkhd'); const mdia = child(buf, t, 'mdia'); const mdhd = child(buf, mdia, 'mdhd')
    const stbl = child(buf, child(buf, mdia, 'minf'), 'stbl')
    const list = (kind, width = 4) => { const b = child(buf, stbl, kind); if (!b) return null
      const from = b.pos + 12; const n = (b.pos + b.size - from) / width
      return Array.from({ length: n }, (_, i) => (width === 8 ? Number(buf.readBigUInt64BE(from + i * 8)) : buf.readUInt32BE(from + i * 4))) }
    const stts = list('stts').slice(1); const stsc = list('stsc').slice(1); const stsz = list('stsz').slice(2)
    // Positions are 32-bit ("stco"), or 64-bit ("co64") in a file too big for that: a 32-bit count, then 64-bit numbers.
    const wide = child(buf, stbl, 'co64')
    const stco = wide
      ? Array.from({ length: buf.readUInt32BE(wide.pos + 12) }, (_, i) => Number(buf.readBigUInt64BE(wide.pos + 16 + i * 8)))
      : list('stco').slice(1)
    const durations = []; for (let i = 0; i < stts.length; i += 2) for (let n = 0; n < stts[i]; n++) durations.push(stts[i + 1])
    // samples per chunk, spread over the chunks
    const perChunk = stco.map((_, c) => { let count = 0; for (let i = 0; i < stsc.length; i += 3) if (stsc[i] <= c + 1) count = stsc[i + 1]; return count })
    const where = []; let n = 0
    stco.forEach((offset, c) => { let at = offset; for (let i = 0; i < perChunk[c]; i++) { where.push(at); at += stsz[n++] } })
    tracks[buf.readUInt32BE(tkhd.pos + 28)] = {
      sizes: stsz, durations, where, keys: list('stss')?.slice(1) ?? null, widePositions: Boolean(wide),
      mediaLength: Number(buf.readBigUInt64BE(mdhd.pos + 32)), trackLength: Number(buf.readBigUInt64BE(tkhd.pos + 36)),
    }
  }
  const mvhd = child(buf, moov, 'mvhd')
  return { order: top.map((b) => b.kind), kinds: boxesIn(buf, moov.pos + 8, moov.pos + moov.size).map((b) => b.kind), tracks, movieLength: Number(buf.readBigUInt64BE(mvhd.pos + 32)) }
}
const marksRight = (buf, track, id) => track.sizes.every((size, n) => buf.subarray(track.where[n], track.where[n] + size).equals(mark(id, n, size)))
const repack = async (bytes) => { const { blob, info } = await flattenMp4(new Blob([bytes])); return { out: Buffer.from(await blob.arrayBuffer()), info } }

section('an ordinary recording: two pieces, picture and sound in each')
{
  const input = Buffer.concat([header(),
    piece(1, [{ track: VIDEO, time: 0, firstNumber: 0, samples: samples(3, 1000, 50) }, { track: SOUND, time: 0, firstNumber: 0, samples: samples(4, 1024, 20) }]),
    piece(2, [{ track: VIDEO, time: 3000, firstNumber: 3, samples: samples(3, 1000, 60) }, { track: SOUND, time: 4096, firstNumber: 4, samples: samples(4, 1024, 30) }])])
  const { out, info } = await repack(input)
  const back = readBack(out)
  check('it opens with the file type, ONE header, then the data', back.order, ['ftyp', 'moov', 'mdat'])
  check('the header no longer says "pieces follow"', back.kinds, ['mvhd', 'trak', 'trak'])
  const oldHeader = header().length
  check('everything after the old header is still there, unchanged, at the end', out.subarray(out.length - (input.length - oldHeader)).equals(input.subarray(oldHeader)), true)
  check('every picture is in the table', back.tracks[1].sizes, [50, 51, 52, 60, 61, 62])
  check('every sound sample too', back.tracks[2].sizes, [20, 21, 22, 23, 30, 31, 32, 33])
  check("each picture's bytes are where the table says", marksRight(out, back.tracks[1], 1), true)
  check("each sound sample's bytes are where the table says", marksRight(out, back.tracks[2], 2), true)
  check('the key pictures are the first of each piece', back.tracks[1].keys, [1, 4])
  check('sound has no key list, which means every sample is one', back.tracks[2].keys, null)
  check('picture times', back.tracks[1].durations, [1000, 1000, 1000, 1000, 1000, 1000])
  check('the picture track says how long it is', back.tracks[1].mediaLength, 6000)
  check('the sound track too', back.tracks[2].mediaLength, 8192)
  check('in the file\'s own clock (thousandths)', [back.tracks[1].trackLength, back.tracks[2].trackLength, back.movieLength], [200, 170, 200])
  check('what it reports', { pieces: info.pieces, seconds: info.seconds, tracks: info.tracks },
    { pieces: 2, seconds: 0.2, tracks: { 1: { samples: 6, runs: 2, keys: 2 }, 2: { samples: 8, runs: 2, keys: 8 } } })
  check('the file grew only by the bigger header and one 16-byte box header', out.length - input.length, info.headerBytes + 16 - (oldHeader - 28))
}

section('a gap between pieces is kept as time, not lost')
{
  const input = Buffer.concat([header(),
    piece(1, [{ track: VIDEO, time: 0, firstNumber: 0, samples: samples(2, 1000, 50) }, { track: SOUND, time: 0, firstNumber: 0, samples: samples(2, 1024, 20) }]),
    piece(2, [{ track: VIDEO, time: 2500, firstNumber: 2, samples: samples(2, 1000, 50) }, { track: SOUND, time: 2048, firstNumber: 2, samples: samples(2, 1024, 20) }])])
  const back = readBack((await repack(input)).out)
  check('the picture before the gap lasts until the next one', back.tracks[1].durations, [1000, 1500, 1000, 1000])
  check('and the bytes are still right', marksRight((await repack(input)).out, back.tracks[1], 1), true)
}

section('the last piece holds a picture and no sound (what a real stop looks like)')
{
  const input = Buffer.concat([header(),
    piece(1, [{ track: VIDEO, time: 0, firstNumber: 0, samples: samples(3, 1000, 50) }, { track: SOUND, time: 0, firstNumber: 0, samples: samples(4, 1024, 20) }]),
    piece(2, [{ track: VIDEO, time: 3000, firstNumber: 3, samples: samples(1, 1000, 60) }, { track: SOUND, time: 0, firstNumber: 4, samples: [] }])])
  const { out, info } = await repack(input)
  const back = readBack(out)
  check('the sound track keeps its real length', back.tracks[2].mediaLength, 4096)
  check('no sound sample has a nonsense length', back.tracks[2].durations, [1024, 1024, 1024, 1024])
  check('the last picture is there', back.tracks[1].sizes, [50, 51, 52, 60])
  check('bytes right', [marksRight(out, back.tracks[1], 1), marksRight(out, back.tracks[2], 2)], [true, true])
  check('sound is in one run, pictures in two', [info.tracks[2].runs, info.tracks[1].runs], [1, 2])
}

section('a recording cut off inside its last piece')
{
  const whole = Buffer.concat([header(),
    piece(1, [{ track: VIDEO, time: 0, firstNumber: 0, samples: samples(3, 1000, 50) }, { track: SOUND, time: 0, firstNumber: 0, samples: samples(4, 1024, 20) }]),
    piece(2, [{ track: VIDEO, time: 3000, firstNumber: 3, samples: samples(3, 1000, 60) }, { track: SOUND, time: 4096, firstNumber: 4, samples: samples(4, 1024, 30) }])])
  const input = whole.subarray(0, whole.length - 200)   // loses the last picture's tail and all of the last piece's sound
  const { out } = await repack(input)
  const back = readBack(out)
  check('only whole pictures are kept', back.tracks[1].sizes, [50, 51, 52, 60])
  check('and only the sound that arrived', back.tracks[2].sizes, [20, 21, 22, 23])
  check('bytes right', [marksRight(out, back.tracks[1], 1), marksRight(out, back.tracks[2], 2)], [true, true])
  check('lengths are what was kept', [back.tracks[1].mediaLength, back.tracks[2].mediaLength], [4000, 4096])
}

section('a recording too big for 32-bit positions (over 4 GB)')
{
  // Nobody can make a 5 GB file in a check, so this is a small recording whose last data box SAYS it runs to
  // 5 GB, behind a stand-in that reports that size. What is being checked is that the tables switch to 64-bit
  // positions and still point at the right bytes.
  const FIVE_GB = 5_000_000_000
  const head = header()
  const first = piece(1, [{ track: VIDEO, time: 0, firstNumber: 0, samples: samples(3, 1000, 50) }, { track: SOUND, time: 0, firstNumber: 0, samples: samples(4, 1024, 20) }])
  const last = piece(2, [{ track: VIDEO, time: 3000, firstNumber: 3, samples: samples(3, 1000, 60) }, { track: SOUND, time: 4096, firstNumber: 4, samples: samples(4, 1024, 30) }])
  const mdatAt = last.indexOf('mdat') - 4
  const lastStart = head.length + first.length + mdatAt
  // The same box with a 64-bit size in front: its data moves 8 bytes on, so the piece's own offsets must too.
  const longLast = Buffer.concat([last.subarray(0, mdatAt), u32(1), Buffer.from('mdat', 'latin1'), u64(FIVE_GB - lastStart), last.subarray(mdatAt + 8)])
  for (const at of [...longLast.subarray(0, mdatAt).toString('latin1').matchAll(/trun/g)].map((m) => m.index)) {
    longLast.writeUInt32BE(longLast.readUInt32BE(at + 12) + 8, at + 12)
  }
  const real = new Blob([head, first, longLast])
  const big = { size: FIVE_GB, slice: (from = 0, to = FIVE_GB) => real.slice(Math.min(from, real.size), Math.min(to, real.size)) }
  const { blob } = await flattenMp4(big)
  const out = Buffer.from(await blob.arrayBuffer())
  const back = readBack(out)
  check('positions are written as 64-bit', [back.tracks[1].widePositions, back.tracks[2].widePositions], [true, true])
  check('and still point at the right bytes', [marksRight(out, back.tracks[1], 1), marksRight(out, back.tracks[2], 2)], [true, true])
  check('nothing was dropped', [back.tracks[1].sizes.length, back.tracks[2].sizes.length], [6, 8])
  const mdat = boxesIn(out, 0, 64 * 1024).find((b) => b.kind === 'mdat')
  check('the one data box says it holds everything after the new header', mdat.size, 16 + FIVE_GB - head.length)
}

section('what it refuses')
{
  const refused = async (bytes) => { try { await repack(bytes); return 'accepted' } catch (error) { return error.message } }
  const backwards = Buffer.concat([header(),
    piece(1, [{ track: VIDEO, time: 5000, firstNumber: 0, samples: samples(2, 1000, 50) }, { track: SOUND, time: 0, firstNumber: 0, samples: samples(2, 1024, 20) }]),
    piece(2, [{ track: VIDEO, time: 1000, firstNumber: 2, samples: samples(2, 1000, 50) }, { track: SOUND, time: 2048, firstNumber: 2, samples: samples(2, 1024, 20) }])])
  check('times that go backwards', await refused(backwards), 'the times in this recording go backwards')
  check('a file that is already ordinary', await refused(header({ fragmented: false })), 'this file is already an ordinary MP4')
  check('something that is not a video', await refused(Buffer.from('not a video at all')), 'expected the file to open with ftyp then moov')
  check('a header with nothing after it', await refused(header()), 'a track with nothing recorded')
}

section("the trial's real recordings")
{
  const folder = '/home/lebardy/skul/PaddlePad-umpire/.superpowers/sdd/2026-10-10-video/recordings'
  const expected = {
    'phone-1080p-3min-last-piece-no-sound.mp4': [92944447, 'cfa702f1e4f3bdfac6d2b6d1cccbd612e672c238260b4c1b5be744be07bf9a96'],
    'phone-720p-4min.mp4': [83266099, 'e03e02ccba96376d3ec28c097af710edf71cf2076c626d512d8915944dbd84dd'],
    'laptop-vp9-11min-cut-off.mp4': [57961960, '1c192f23e0f42535849377948b45a19c9cde43f89dd3d100709bdc0ba3500c25'],
    'laptop-vp9-25s.mp4': [2140642, 'f6cf9218210850c06434029cb0df442ac621427cec187ad851a37f3da345aca0'],
  }
  if (!existsSync(folder)) console.log('  skip (the recordings are not on this machine)')
  else for (const [name, [size, hash]] of Object.entries(expected)) {
    const { blob } = await flattenMp4(await openAsBlob(`${folder}/${name}`))
    const out = Buffer.from(await blob.arrayBuffer())
    check(`${name}: byte for byte the file that was proven`, [out.length, createHash('sha256').update(out).digest('hex')], [size, hash])
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
