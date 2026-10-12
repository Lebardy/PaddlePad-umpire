// ============================================================
// Sends one file straight to the video bucket through a form the
// server signed. XMLHttpRequest rather than fetch, because only it
// reports how much has gone, and a 500 MB send with no progress looks
// exactly like a hung one.
// ============================================================

/**
 * Resolves once the bucket has stored the file. `onProgress` is called
 * with the part sent so far, 0 to 1. A single send cannot resume: after
 * a dropped connection the caller starts it again from nothing.
 */
export function sendToBucket(form, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const data = new FormData()
    for (const [name, value] of Object.entries(form.fields)) data.append(name, value)
    // The file goes last: the bucket ignores any field after it.
    data.append('file', blob, 'match.mp4')
    const request = new XMLHttpRequest()
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else reject(Object.assign(new Error(`The storage refused the video (${request.status})`), { refused: request.status >= 400 && request.status < 500 }))
    }
    request.onerror = () => reject(new Error('The connection dropped while sending'))
    request.open('POST', form.url)
    request.send(data)
  })
}
