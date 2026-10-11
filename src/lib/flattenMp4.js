// ============================================================
// The repack: turns a browser's recording into an ordinary video file.
//
// A browser records MP4 as a short header followed by hundreds of
// small pieces, each with its own little table of pictures and sounds
// ("fragmented"). Chrome-type players cope with that; Firefox-type
// players show such a file as a fraction of a second long and cannot
// jump in it. An ordinary MP4 has ONE header holding the full tables.
//
// This reads only the header and each piece's small table -- never the
// pictures -- writes one new header with the full tables, and returns
//   new Blob([file type box, new header, data box header, recording.slice(end of the old header)])
// so nothing is copied or re-encoded: 1.8 s for a 15-minute match on a
// 2019 phone, and the file grows by about 0.2%. The old piece tables
// stay inside the data box as ignored filler.
//
// It refuses (throws) rather than write a file it is not sure of; the
// caller then sends the recording as filmed.
//
//   const { blob, info } = await flattenMp4(recording)
// ============================================================

export async function flattenMp4(recording) {
  const total = recording.size
  const read = async (from, to) => new Uint8Array(await recording.slice(from, Math.min(to, total)).arrayBuffer())
  const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const kindAt = (u8, at) => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3])
  let reads = 0

  // Boxes inside bytes already in memory: [{ kind, pos, size, header }]
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
  // A full box whose body is a list of numbers: 32-bit each, or, when `wide`, a 32-bit count followed by
  // 64-bit numbers. With `signedFrom`, every second number from that index on is written as signed
  // (a picture offset can be negative).
  const numbers = (kind, version, list, wide = false, signedFrom = -1) => {
    const out = new Uint8Array(4 + (wide ? 4 + (list.length - 1) * 8 : list.length * 4)); const dv = view(out)
    dv.setUint32(0, version << 24)
    if (wide) {
      dv.setUint32(4, list[0])
      for (let i = 1; i < list.length; i++) dv.setBigUint64(8 + (i - 1) * 8, BigInt(list[i]))
    } else {
      for (let i = 0; i < list.length; i++) {
        const signed = signedFrom >= 0 && i >= signedFrom && (i - signedFrom) % 2 === 1
        if (signed) dv.setInt32(4 + i * 4, list[i])
        else dv.setUint32(4 + i * 4, list[i])
      }
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

  // 1. The file's outline: only each box's first 16 bytes are read.
  const top = []
  for (let pos = 0; pos + 8 <= total;) {
    const head = await read(pos, pos + 16); reads++
    const dv = view(head)
    let size = dv.getUint32(0), header = 8
    if (size === 1) { if (head.length < 16) break; size = Number(dv.getBigUint64(8)); header = 16 } else if (size === 0) size = total - pos
    if (size < header) break
    top.push({ kind: kindAt(head, 4), pos, size: Math.min(size, total - pos), header })
    pos += size
  }
  const ftyp = top.find((b) => b.kind === 'ftyp'); const moovAt = top.find((b) => b.kind === 'moov')
  if (!ftyp || !moovAt || ftyp.pos !== 0 || moovAt.pos !== ftyp.size) throw new Error('expected the file to open with ftyp then moov')
  const oldEnd = moovAt.pos + moovAt.size
  const moov = await read(moovAt.pos, oldEnd); reads++
  const moovKids = boxes(moov, 8, moov.length)
  if (!moovKids.some((b) => b.kind === 'mvex')) throw new Error('this file is already an ordinary MP4')

  let movieScale = 0; const trex = {}
  for (const b of moovKids) {
    if (b.kind === 'mvhd') movieScale = view(moov).getUint32(b.pos + 8 + (moov[b.pos + 8] === 1 ? 20 : 12))
    if (b.kind === 'mvex') for (const t of boxes(moov, b.pos + b.header, b.pos + b.size)) {
      if (t.kind !== 'trex') continue
      const dv = view(moov); const at = t.pos + t.header + 4
      trex[dv.getUint32(at)] = { duration: dv.getUint32(at + 8), size: dv.getUint32(at + 12), flags: dv.getUint32(at + 16) }
    }
  }

  // 2. Every piece's table. Per track: each sample's time, size, key flag and picture offset, and the runs they sit in.
  const tracks = {}
  let pieces = 0
  for (const piece of top) {
    if (piece.kind !== 'moof') continue
    pieces++
    const u8 = await read(piece.pos, piece.pos + piece.size); reads++
    const dv = view(u8)
    for (const traf of boxes(u8, piece.header, u8.length)) {
      if (traf.kind !== 'traf') continue
      const kids = boxes(u8, traf.pos + traf.header, traf.pos + traf.size)
      const tfhd = kids.find((b) => b.kind === 'tfhd'); const tfdt = kids.find((b) => b.kind === 'tfdt')
      let at = tfhd.pos + tfhd.header
      const flags = dv.getUint32(at) & 0xFFFFFF; const trackId = dv.getUint32(at + 4)
      if (flags & 0x1 || !(flags & 0x020000)) throw new Error('a piece does not address its data relative to itself')
      at += 8 + (flags & 0x2 ? 4 : 0)
      const fallback = { ...trex[trackId] }
      for (const [bit, name] of [[0x8, 'duration'], [0x10, 'size'], [0x20, 'flags']]) if (flags & bit) { fallback[name] = dv.getUint32(at); at += 4 }
      at = tfdt.pos + tfdt.header
      let time = u8[at] === 1 ? Number(dv.getBigUint64(at + 4)) : dv.getUint32(at + 4)
      const track = (tracks[trackId] ??= { times: [], sizes: [], keys: [], offsets: [], chunks: [], end: 0 })
      for (const trun of kids) {
        if (trun.kind !== 'trun') continue
        at = trun.pos + trun.header
        const version = u8[at]; const tflags = dv.getUint32(at) & 0xFFFFFF; const count = dv.getUint32(at + 4)
        if (!(tflags & 0x1)) throw new Error('a run without a data offset')
        let where = piece.pos + dv.getInt32(at + 8)
        at += 12
        let firstFlags = null
        if (tflags & 0x4) { firstFlags = dv.getUint32(at); at += 4 }
        const start = where; let kept = 0
        for (let i = 0; i < count; i++) {
          let duration = fallback.duration, size = fallback.size, sflags = fallback.flags, offset = 0
          if (tflags & 0x100) { duration = dv.getUint32(at); at += 4 }
          if (tflags & 0x200) { size = dv.getUint32(at); at += 4 }
          if (tflags & 0x400) { sflags = dv.getUint32(at); at += 4 } else if (i === 0 && firstFlags !== null) sflags = firstFlags
          if (tflags & 0x800) { offset = version ? dv.getInt32(at) : dv.getUint32(at); at += 4 }
          if (where + size > total) break                       // the recording was cut off inside this piece
          track.times.push(time); track.sizes.push(size); track.keys.push(!(sflags & 0x10000)); track.offsets.push(offset)
          time += duration; where += size; kept++
        }
        if (kept) { track.end = time; track.chunks.push([start, kept]) }   // a run with nothing in it says nothing about the track's end
      }
    }
  }

  function tables(track, isVideo, shift, wide) {
    const n = track.times.length; const parts = []
    const durations = track.times.map((t, i) => (i + 1 < n ? track.times[i + 1] : track.end) - t)
    if (durations.some((d) => d < 0)) throw new Error('the times in this recording go backwards')
    const stts = runs(durations)
    parts.push(numbers('stts', 0, [stts.length, ...stts.flat()]))
    if (track.offsets.some((o) => o)) { const ctts = runs(track.offsets); parts.push(numbers('ctts', 1, [ctts.length, ...ctts.flat()], false, 1)) }
    if (isVideo && !track.keys.every((k) => k)) { const keys = []; track.keys.forEach((k, i) => { if (k) keys.push(i + 1) }); parts.push(numbers('stss', 0, [keys.length, ...keys])) }
    const stsc = []
    track.chunks.forEach(([, count], i) => { if (!stsc.length || stsc[stsc.length - 1][1] !== count) stsc.push([i + 1, count, 1]) })
    parts.push(numbers('stsc', 0, [stsc.length, ...stsc.flat()]))
    parts.push(numbers('stsz', 0, [0, n, ...track.sizes]))
    parts.push(numbers(wide ? 'co64' : 'stco', 0, [track.chunks.length, ...track.chunks.map(([start]) => start + shift)], wide))
    return { parts, mediaLength: durations.reduce((a, b) => a + b, 0) }
  }

  // 3. The new header. `shift` = how far the kept bytes move (new position - old position).
  function build(shift, wide) {
    const lengths = {}
    const trak = (t) => {
      const kids = boxes(moov, t.pos + 8, t.pos + t.size)
      const tkhd = kids.find((b) => b.kind === 'tkhd'); const mdia = kids.find((b) => b.kind === 'mdia')
      const trackId = view(moov).getUint32(tkhd.pos + 8 + (moov[tkhd.pos + 8] === 1 ? 20 : 12))
      const mkids = boxes(moov, mdia.pos + 8, mdia.pos + mdia.size)
      const hdlr = mkids.find((b) => b.kind === 'hdlr'); const mdhd = mkids.find((b) => b.kind === 'mdhd'); const minf = mkids.find((b) => b.kind === 'minf')
      const isVideo = kindAt(moov, hdlr.pos + 16) === 'vide'
      const scale = view(moov).getUint32(mdhd.pos + 8 + (moov[mdhd.pos + 8] === 1 ? 20 : 12))
      if (!tracks[trackId] || !tracks[trackId].times.length) throw new Error('a track with nothing recorded')
      let mediaLength = 0
      const minfParts = boxes(moov, minf.pos + 8, minf.pos + minf.size).map((b) => {
        if (b.kind !== 'stbl') return moov.subarray(b.pos, b.pos + b.size)
        const stsd = boxes(moov, b.pos + 8, b.pos + b.size).filter((s) => s.kind === 'stsd').map((s) => moov.subarray(s.pos, s.pos + s.size))
        const made = tables(tracks[trackId], isVideo, shift, wide); mediaLength = made.mediaLength
        return box('stbl', [...stsd, ...made.parts])
      })
      const movieLength = Math.floor(mediaLength * movieScale / scale)
      lengths[trackId] = movieLength
      const mdiaParts = mkids.map((b) => (b.kind === 'mdhd' ? withDuration(moov, b, 16, 24, mediaLength) : b.kind === 'minf' ? box('minf', minfParts) : moov.subarray(b.pos, b.pos + b.size)))
      return box('trak', kids.map((b) => (b.kind === 'tkhd' ? withDuration(moov, b, 20, 28, movieLength) : b.kind === 'mdia' ? box('mdia', mdiaParts) : moov.subarray(b.pos, b.pos + b.size))))
    }
    const kept = moovKids.filter((b) => b.kind !== 'mvex')
    const made = kept.map((b) => (b.kind === 'trak' ? trak(b) : null))
    const movie = Math.max(...Object.values(lengths))
    return { header: box('moov', kept.map((b, i) => (b.kind === 'mvhd' ? withDuration(moov, b, 16, 24, movie) : made[i] ?? moov.subarray(b.pos, b.pos + b.size)))), movie }
  }

  // The header's size does not depend on the positions written in it, so build once to learn it, then for real.
  const wide = total + (1 << 20) > 0xFFFFFFFF
  const draft = build(0, wide).header
  const dataHeader = new Uint8Array(16); const dh = view(dataHeader)
  dh.setUint32(0, 1); dataHeader.set([0x6d, 0x64, 0x61, 0x74], 4); dh.setBigUint64(8, BigInt(16 + total - oldEnd))
  const shift = ftyp.size + draft.length + dataHeader.length - oldEnd
  const { header, movie } = build(shift, wide)
  if (header.length !== draft.length) throw new Error('the header changed size')
  const blob = new Blob([recording.slice(0, ftyp.size), header, dataHeader, recording.slice(oldEnd)], { type: 'video/mp4' })
  const info = { pieces, reads, headerBytes: header.length, seconds: movie / movieScale, tracks: {} }
  for (const [id, t] of Object.entries(tracks)) info.tracks[id] = { samples: t.times.length, runs: t.chunks.length, keys: t.keys.filter(Boolean).length }
  return { blob, info }
}
