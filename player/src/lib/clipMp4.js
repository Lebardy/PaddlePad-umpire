// ============================================================
// Cutting clips out of a match video, on the phone, with no video tool.
//
// A repacked match video is an ordinary MP4: a short file type box, then
// one header ("moov") with the full tables of every picture and sound,
// then the data. That header says where each sample's bytes sit, so a
// clip needs only: the header, the clip's own bytes (one ranged request),
// and a new small header for them. Nothing is re-encoded.
//
// A clip starts on the key picture at or before the asked start (a
// picture that needs no earlier one to be drawn): on the phones tried,
// there is one every 3.4-4.2 s, so a saved clip can begin a few seconds
// early, never late. Several clips laid end to end make one reel file.
//
//   const read = rangeReader(video.url)
//   const index = await readIndex(read)
//   const blob = await cutClips(read, index, [{ start, end }], onProgress)
// ============================================================

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
const kindAt = (u8, at) => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3])

// ---- box helpers, as in flattenMp4.js (that file is kept as it is: the umpire app holds the same copy) ----
function boxes(u8, start, end) {
  const dv = view(u8); const out = []
  let pos = start
  while (pos + 8 <= end) {
    let size = dv.getUint32(pos), header = 8
    if (size === 1) { size = Number(dv.getBigUint64(pos + 8)); header = 16 } else if (size === 0) size = end - pos
    if (size < header) break
    out.push({ kind: kindAt(u8, pos + 4), pos, size: Math.min(size, end - pos), header })
    pos += size
  }
  return out
}
const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const box = (kind, parts) => {
  const body = cat(parts); const out = new Uint8Array(8 + body.length)
  view(out).setUint32(0, out.length)
  for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i)
  out.set(body, 8)
  return out
}
const numbers = (kind, version, list, signedFrom = -1) => {
  const out = new Uint8Array(4 + list.length * 4); const dv = view(out)
  dv.setUint32(0, version << 24)
  for (let i = 0; i < list.length; i++) {
    const signed = signedFrom >= 0 && i >= signedFrom && (i - signedFrom) % 2 === 1
    if (signed) dv.setInt32(4 + i * 4, list[i])
    else dv.setUint32(4 + i * 4, list[i])
  }
  return box(kind, [out])
}
const runs = (values) => {
  const out = []
  for (const v of values) { if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++; else out.push([1, v]) }
  return out
}
const withDuration = (u8, b, atV0, atV1, duration) => {
  const raw = u8.slice(b.pos, b.pos + b.size); const dv = view(raw)
  if (raw[8] === 1) dv.setBigUint64(8 + atV1, BigInt(duration)); else dv.setUint32(8 + atV0, Math.min(duration, 0xFFFFFFFF))
  return raw
}
const versioned = (u8, b, at0, at1) => (u8[b.pos + 8] === 1 ? at1 : at0)

/** Reads bytes [from, to) of the file at `url` with one ranged request. */
export function rangeReader(url, { signal } = {}) {
  return async (from, to) => {
    const answer = await fetch(url, { headers: { Range: `bytes=${from}-${to - 1}` }, signal })
    if (answer.status !== 206) throw new Error(`the video answered ${answer.status}`)
    return new Uint8Array(await answer.arrayBuffer())
  }
}

/** The file's header and every track's samples. Throws for anything but a repacked (ordinary) MP4. */
export async function readIndex(read) {
  const head = await read(0, 65536)
  const top = boxes(head, 0, head.length)
  const ftyp = top[0]
  if (!ftyp || ftyp.kind !== 'ftyp' || head.length < ftyp.size + 8) throw new Error('not a video file')
  const moovSize = view(head).getUint32(ftyp.size)
  if (kindAt(head, ftyp.size + 4) !== 'moov') throw new Error('this video has no header at its front')
  const moov = moovSize <= head.length - ftyp.size ? head.slice(ftyp.size, ftyp.size + moovSize) : await read(ftyp.size, ftyp.size + moovSize)
  const kids = boxes(moov, 8, moov.length)
  if (kids.some((b) => b.kind === 'mvex')) throw new Error('this video was not repacked')
  const mvhd = kids.find((b) => b.kind === 'mvhd')
  const dv = view(moov)
  const movieScale = dv.getUint32(mvhd.pos + 8 + versioned(moov, mvhd, 12, 20))
  const movieLength = moov[mvhd.pos + 8] === 1 ? Number(dv.getBigUint64(mvhd.pos + 8 + 24)) : dv.getUint32(mvhd.pos + 8 + 16)
  const tracks = kids.filter((b) => b.kind === 'trak').map((t) => track(moov, t))
  return { ftyp: head.slice(0, ftyp.size), moov, kids, movieScale, seconds: movieLength / movieScale, tracks }
}

function track(moov, t) {
  const dv = view(moov)
  const kids = boxes(moov, t.pos + 8, t.pos + t.size)
  const tkhd = kids.find((b) => b.kind === 'tkhd'); const mdia = kids.find((b) => b.kind === 'mdia')
  const mkids = boxes(moov, mdia.pos + 8, mdia.pos + mdia.size)
  const hdlr = mkids.find((b) => b.kind === 'hdlr'); const mdhd = mkids.find((b) => b.kind === 'mdhd'); const minf = mkids.find((b) => b.kind === 'minf')
  const nkids = boxes(moov, minf.pos + 8, minf.pos + minf.size)
  const stbl = nkids.find((b) => b.kind === 'stbl')
  const sk = Object.fromEntries(boxes(moov, stbl.pos + 8, stbl.pos + stbl.size).map((b) => [b.kind, b]))
  const list = (b, from) => { const at = b.pos + 12; const n = dv.getUint32(at); return { n, at: at + 4 + (from ?? 0) } }

  // Durations and decode times.
  const durations = []
  { const { n, at } = list(sk.stts); for (let i = 0; i < n; i++) { const count = dv.getUint32(at + i * 8); const d = dv.getUint32(at + i * 8 + 4); for (let k = 0; k < count; k++) durations.push(d) } }
  const times = []; let time = 0
  for (const d of durations) { times.push(time); time += d }
  // Picture offsets (signed in version 1).
  const offsets = []
  if (sk.ctts) { const v1 = moov[sk.ctts.pos + 8] === 1; const { n, at } = list(sk.ctts); for (let i = 0; i < n; i++) { const count = dv.getUint32(at + i * 8); const o = v1 ? dv.getInt32(at + i * 8 + 4) : dv.getUint32(at + i * 8 + 4); for (let k = 0; k < count; k++) offsets.push(o) } }
  // Sizes.
  const sizes = []
  { const fixed = dv.getUint32(sk.stsz.pos + 12); const n = dv.getUint32(sk.stsz.pos + 16); for (let i = 0; i < n; i++) sizes.push(fixed || dv.getUint32(sk.stsz.pos + 20 + i * 4)) }
  // Keys: no stss means every sample is key.
  const keys = sizes.map(() => !sk.stss)
  if (sk.stss) { const { n, at } = list(sk.stss); for (let i = 0; i < n; i++) keys[dv.getUint32(at + i * 4) - 1] = true }
  // Chunk starts, then each sample's position from stsc.
  const chunkStarts = []
  if (sk.stco) { const { n, at } = list(sk.stco); for (let i = 0; i < n; i++) chunkStarts.push(dv.getUint32(at + i * 4)) }
  else { const { n, at } = list(sk.co64); for (let i = 0; i < n; i++) chunkStarts.push(Number(dv.getBigUint64(at + i * 8))) }
  const stsc = []
  { const { n, at } = list(sk.stsc); for (let i = 0; i < n; i++) stsc.push([dv.getUint32(at + i * 12), dv.getUint32(at + i * 12 + 4)]) }
  const positions = []
  let sample = 0
  for (let c = 0; c < chunkStarts.length; c++) {
    let perChunk = 0
    for (const [first, count] of stsc) if (first <= c + 1) perChunk = count
    let at = chunkStarts[c]
    for (let k = 0; k < perChunk && sample < sizes.length; k++) { positions.push(at); at += sizes[sample]; sample++ }
  }
  return {
    box: t, kids, tkhd, mdia, mkids, mdhd, minf, nkids, stbl, stsd: sk.stsd,
    handler: kindAt(moov, hdlr.pos + 16),
    scale: dv.getUint32(mdhd.pos + 8 + versioned(moov, mdhd, 12, 20)),
    times, durations, offsets, sizes, keys, positions,
  }
}

/** One MP4 holding `clips` ([{ start, end }] in seconds) one after another. */
export async function cutClips(read, index, clips, onProgress) {
  const video = index.tracks.find((t) => t.handler === 'vide')
  const sound = index.tracks.find((t) => t.handler === 'soun')
  if (!video) throw new Error('this video has no pictures')
  const picked = { vide: [], soun: [] }   // sample numbers, in output order
  const chunks = []                      // { handler, count, bytes: Uint8Array[] } in file order
  let held = -1                          // the last picture the clips so far hold
  for (const [n, clip] of clips.entries()) {
    const at = (t, s) => t.times[s] / t.scale
    let first = 0
    for (let s = 0; s < video.times.length && at(video, s) <= clip.start; s++) if (video.keys[s]) first = s
    // A highlight starting inside the one before (the next rally) carries on from it rather than playing it again.
    if (first <= held) first = held + 1
    if (first >= video.times.length) { onProgress?.((n + 1) / clips.length); continue }
    let last = first
    while (last + 1 < video.times.length && at(video, last + 1) < clip.end) last++
    held = last
    const from = at(video, first); const to = (video.times[last] + video.durations[last]) / video.scale
    const vids = range(first, last)
    const sounds = sound ? sound.times.map((_, s) => s).filter((s) => at(sound, s) >= from && at(sound, s) < to) : []
    const all = [...vids.map((s) => [video, s]), ...sounds.map((s) => [sound, s])]
    const low = Math.min(...all.map(([t, s]) => t.positions[s]))
    const high = Math.max(...all.map(([t, s]) => t.positions[s] + t.sizes[s]))
    const bytes = await read(low, high)
    const take = (t, s) => bytes.subarray(t.positions[s] - low, t.positions[s] - low + t.sizes[s])
    chunks.push({ handler: 'vide', count: vids.length, bytes: vids.map((s) => take(video, s)) })
    picked.vide.push(...vids)
    if (sounds.length) {
      chunks.push({ handler: 'soun', count: sounds.length, bytes: sounds.map((s) => take(sound, s)) })
      picked.soun.push(...sounds)
    }
    onProgress?.((n + 1) / clips.length)
  }

  const { moov, kids, movieScale } = index
  function tables(t, starts) {
    const list = picked[t.handler]
    const durations = list.map((s) => t.durations[s])
    const parts = []
    const stts = runs(durations)
    parts.push(numbers('stts', 0, [stts.length, ...stts.flat()]))
    if (t.offsets.length && list.some((s) => t.offsets[s])) { const ctts = runs(list.map((s) => t.offsets[s])); parts.push(numbers('ctts', 1, [ctts.length, ...ctts.flat()], 1)) }
    if (t.handler === 'vide') { const keyed = []; list.forEach((s, i) => { if (t.keys[s]) keyed.push(i + 1) }); if (keyed.length < list.length) parts.push(numbers('stss', 0, [keyed.length, ...keyed])) }
    const mine = chunks.filter((c) => c.handler === t.handler)
    const stsc = []
    mine.forEach((c, i) => { if (!stsc.length || stsc[stsc.length - 1][1] !== c.count) stsc.push([i + 1, c.count, 1]) })
    parts.push(numbers('stsc', 0, [stsc.length, ...stsc.flat()]))
    parts.push(numbers('stsz', 0, [0, list.length, ...list.map((s) => t.sizes[s])]))
    parts.push(numbers('stco', 0, [starts.length, ...starts]))
    return { parts, mediaLength: durations.reduce((a, b) => a + b, 0) }
  }
  function build(dataStart) {
    // Where each chunk lands, per track.
    const starts = { vide: [], soun: [] }
    let at = dataStart
    for (const c of chunks) { starts[c.handler].push(at); at += c.bytes.reduce((n, b) => n + b.length, 0) }
    const lengths = []
    const traks = index.tracks.filter((t) => picked[t.handler]?.length).map((t) => {
      const made = tables(t, starts[t.handler])
      const movieLength = Math.floor(made.mediaLength * movieScale / t.scale)
      lengths.push(movieLength)
      const stbl = box('stbl', [moov.subarray(t.stsd.pos, t.stsd.pos + t.stsd.size), ...made.parts])
      const minf = box('minf', t.nkids.map((b) => (b.kind === 'stbl' ? stbl : moov.subarray(b.pos, b.pos + b.size))))
      const mdia = box('mdia', t.mkids.map((b) => (b.kind === 'mdhd' ? withDuration(moov, b, 16, 24, made.mediaLength) : b.kind === 'minf' ? minf : moov.subarray(b.pos, b.pos + b.size))))
      return box('trak', t.kids.filter((b) => b.kind !== 'edts').map((b) => (b.kind === 'tkhd' ? withDuration(moov, b, 20, 28, movieLength) : b.kind === 'mdia' ? mdia : moov.subarray(b.pos, b.pos + b.size))))
    })
    const movie = Math.max(...lengths)
    const out = []
    let placed = false
    for (const b of kids) {
      if (b.kind === 'mvhd') out.push(withDuration(moov, b, 16, 24, movie))
      else if (b.kind === 'trak') { if (!placed) { out.push(...traks); placed = true } }
      else if (b.kind !== 'mvex') out.push(moov.subarray(b.pos, b.pos + b.size))
    }
    return box('moov', out)
  }
  const dataBytes = chunks.reduce((n, c) => n + c.bytes.reduce((m, b) => m + b.length, 0), 0)
  const draft = build(0)
  const dataStart = index.ftyp.length + draft.length + 16
  const header = build(dataStart)
  if (header.length !== draft.length) throw new Error('the header changed size')
  const dataHeader = new Uint8Array(16); const dh = view(dataHeader)
  dh.setUint32(0, 1); dataHeader.set([0x6d, 0x64, 0x61, 0x74], 4); dh.setBigUint64(8, BigInt(16 + dataBytes))
  return new Blob([index.ftyp, header, dataHeader, ...chunks.flatMap((c) => c.bytes)], { type: 'video/mp4' })
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
