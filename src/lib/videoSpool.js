// ============================================================
// Saves a recording to the phone as it is filmed, so a reload or a
// crash does not lose it. The chunks stay until the video has been
// sent (or refused for good); the next Camera screen finds what is
// left and sends it.
//
// Best effort: filming must never stop because saving failed, so
// every function here swallows its errors.
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000

let opened = null
function db() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('paddlepad.video', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta', { keyPath: 'matchId' })
      request.result.createObjectStore('chunks', { keyPath: ['matchId', 'index'] })
    }
    request.onsuccess = () => {
      const database = request.result
      // A lost or outdated connection is opened afresh next time, not kept for the life of the page.
      database.onclose = () => { opened = null }
      database.onversionchange = () => { database.close(); opened = null }
      resolve(database)
    }
    request.onerror = () => reject(request.error)
  }).catch((error) => { opened = null; throw error })
  return opened
}

/** Runs `work(meta, chunks)` in one transaction and resolves when it commits. */
async function inTransaction(work) {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['meta', 'chunks'], 'readwrite')
    let result
    tx.oncomplete = () => resolve(result)
    tx.onerror = tx.onabort = () => reject(tx.error)
    result = work(tx.objectStore('meta'), tx.objectStore('chunks'))
  })
}

const wait = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })

/**
 * A recording begins: `info` is { deviceId, width, height, startedAt, firstFrameAt }.
 * Anything left of an earlier recording of the same match goes, so the two are never joined.
 */
export function spoolStart(matchId, info) {
  return inTransaction((meta, chunks) => {
    chunks.delete(IDBKeyRange.bound([matchId, 0], [matchId, Infinity]))
    meta.put({ matchId, ...info, lastChunkAt: info.startedAt })
  }).catch(() => {})
}

export function spoolChunk(matchId, index, blob) {
  return inTransaction((meta, chunks) => {
    chunks.put({ matchId, index, blob })
    const read = meta.get(matchId)
    read.onsuccess = () => { if (read.result) meta.put({ ...read.result, lastChunkAt: Date.now() }) }
  }).catch(() => {})
}

export function spoolRemove(matchId) {
  return inTransaction((meta, chunks) => {
    meta.delete(matchId)
    chunks.delete(IDBKeyRange.bound([matchId, 0], [matchId, Infinity]))
  }).catch(() => {})
}

/**
 * Every saved recording as { matchId, blob, meta }, oldest first. One
 * the server would refuse by now (a day old) is deleted instead.
 * Gives up after a few seconds: some browsers never answer an open, and the camera waits on this.
 */
export function spoolRecovered(now = Date.now()) {
  return Promise.race([findSaved(now), new Promise((resolve) => setTimeout(resolve, 5_000, []))])
}

async function findSaved(now) {
  let database, metas
  try {
    database = await db()
    metas = await wait(database.transaction('meta').objectStore('meta').getAll())
  } catch {
    return []
  }
  const found = []
  for (const meta of metas) {
    // One unreadable recording must not hide the others.
    try {
      if (now - meta.lastChunkAt > DAY_MS) { await spoolRemove(meta.matchId); continue }
      const saved = await wait(database.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([meta.matchId, 0], [meta.matchId, Infinity])))
      // A chunk that failed to save leaves a hole: what comes after it cannot be joined on.
      let joined = 0
      while (joined < saved.length && saved[joined].index === joined) joined += 1
      const chunks = saved.slice(0, joined)
      if (chunks.length === 0) { await spoolRemove(meta.matchId); continue }
      found.push({ matchId: meta.matchId, blob: new Blob(chunks.map((chunk) => chunk.blob), { type: 'video/mp4' }), meta })
    } catch { /* left for the next Camera screen */ }
  }
  return found.sort((a, b) => a.meta.startedAt - b.meta.startedAt)
}
