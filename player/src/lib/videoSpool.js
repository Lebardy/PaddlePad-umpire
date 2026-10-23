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
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
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

/** A recording begins: `info` is { deviceId, width, height, startedAt, firstFrameAt }. */
export function spoolStart(matchId, info) {
  return inTransaction((meta) => meta.put({ matchId, ...info, lastChunkAt: info.startedAt })).catch(() => {})
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
 */
export async function spoolRecovered(now = Date.now()) {
  try {
    const database = await db()
    const read = (store, query) => wait(database.transaction(store).objectStore(store).getAll(query))
    const found = []
    for (const meta of await read('meta')) {
      if (now - meta.lastChunkAt > DAY_MS) { await spoolRemove(meta.matchId); continue }
      const saved = await read('chunks', IDBKeyRange.bound([meta.matchId, 0], [meta.matchId, Infinity]))
      // A chunk that failed to save leaves a hole: what comes after it cannot be joined on.
      let joined = 0
      while (joined < saved.length && saved[joined].index === joined) joined += 1
      const chunks = saved.slice(0, joined)
      if (chunks.length === 0) { await spoolRemove(meta.matchId); continue }
      found.push({ matchId: meta.matchId, blob: new Blob(chunks.map((chunk) => chunk.blob), { type: 'video/mp4' }), meta })
    }
    return found.sort((a, b) => a.meta.startedAt - b.meta.startedAt)
  } catch {
    return []
  }
}
