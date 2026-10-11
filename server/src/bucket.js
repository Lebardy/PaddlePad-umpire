// ============================================================
// The video bucket: settings, signed links and forms, and the three
// things the server itself asks of it (a file's size, delete, list).
//
// Video never passes through this server. A phone sends its file
// straight to the bucket with a form signed here, and a viewer plays it
// straight from the bucket with a link signed here. What is here is the
// signing ("AWS Signature Version 4", which Railway's buckets speak),
// written on Node's own crypto: the ready-made storage library does the
// same and costs about 34 MB of memory in a server whose bill is memory.
// ============================================================

import { createHash, createHmac } from 'node:crypto'

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const EMPTY_BODY = sha256('')

/**
 * The bucket's settings, or null when any is missing -- which is how an
 * environment says "no video here". Every caller treats null as off.
 */
export function bucketConfig(env = process.env) {
  const bucket = env.VIDEO_BUCKET
  const endpoint = env.VIDEO_BUCKET_ENDPOINT
  const region = env.VIDEO_BUCKET_REGION
  const keyId = env.VIDEO_BUCKET_KEY_ID
  const secret = env.VIDEO_BUCKET_SECRET
  if (!bucket || !endpoint || !region || !keyId || !secret || !URL.canParse(endpoint)) return null
  const host = `${bucket}.${new URL(endpoint).host}`
  return { bucket, region, keyId, secret, host, origin: `https://${host}` }
}

// The scheme's own escaping: everything but letters, digits and -._~
const escape = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const pathOf = (key) => `/${key.split('/').map(escape).join('/')}`
const queryOf = (params) => Object.keys(params).sort().map((k) => `${escape(k)}=${escape(String(params[k]))}`).join('&')

function stamp(now) {
  const time = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')   // 20130524T000000Z
  return { time, day: time.slice(0, 8) }
}

function signingKey(config, day) {
  return hmac(hmac(hmac(hmac(`AWS4${config.secret}`, day), config.region), 's3'), 'aws4_request')
}

function sign(config, { time, day }, canonicalRequest) {
  const scope = `${day}/${config.region}/s3/aws4_request`
  const toSign = `AWS4-HMAC-SHA256\n${time}\n${scope}\n${sha256(canonicalRequest)}`
  return { scope, signature: hmac(signingKey(config, day), toSign).toString('hex') }
}

/** A link that reads one file, good for `seconds`. Nothing is asked of the bucket to make it. */
export function signedReadUrl(config, key, { seconds = 7200, now = new Date() } = {}) {
  const at = stamp(now)
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.keyId}/${at.day}/${config.region}/s3/aws4_request`,
    'X-Amz-Date': at.time,
    'X-Amz-Expires': seconds,
    'X-Amz-SignedHeaders': 'host',
  }
  const query = queryOf(params)
  const { signature } = sign(config, at, `GET\n${pathOf(key)}\n${query}\nhost:${config.host}\n\nhost\nUNSIGNED-PAYLOAD`)
  return `${config.origin}${pathOf(key)}?${query}&X-Amz-Signature=${signature}`
}

/**
 * A form a browser can post one file with: exactly this name, this
 * type and this many bytes, for `seconds`. The bucket refuses anything
 * else, so the size limit is enforced there and not only in the page.
 */
export function signedUploadForm(config, key, { bytes, seconds = 3600, now = new Date() }) {
  const at = stamp(now)
  const credential = `${config.keyId}/${at.day}/${config.region}/s3/aws4_request`
  const policy = Buffer.from(JSON.stringify({
    expiration: new Date(now.getTime() + seconds * 1000).toISOString(),
    conditions: [
      { bucket: config.bucket },
      { key },
      { 'Content-Type': 'video/mp4' },
      ['content-length-range', bytes, bytes],
      { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
      { 'x-amz-credential': credential },
      { 'x-amz-date': at.time },
    ],
  })).toString('base64')
  return {
    url: `${config.origin}/`,
    fields: {
      bucket: config.bucket,
      key,
      'Content-Type': 'video/mp4',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': at.time,
      Policy: policy,
      'X-Amz-Signature': hmac(signingKey(config, at.day), policy).toString('hex'),
    },
  }
}

/** A request this server makes of the bucket itself, signed in its headers. */
async function ask(config, method, path, params = {}) {
  const at = stamp(new Date())
  const query = queryOf(params)
  const canonical = `${method}\n${path}\n${query}\nhost:${config.host}\nx-amz-content-sha256:${EMPTY_BODY}\nx-amz-date:${at.time}\n\n` +
    `host;x-amz-content-sha256;x-amz-date\n${EMPTY_BODY}`
  const { scope, signature } = sign(config, at, canonical)
  return fetch(`${config.origin}${path}${query ? `?${query}` : ''}`, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      'x-amz-content-sha256': EMPTY_BODY,
      'x-amz-date': at.time,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.keyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  })
}

/** How many bytes a file holds, or null when it is not there. */
export async function fileSize(config, key) {
  const response = await ask(config, 'HEAD', pathOf(key))
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`The bucket answered ${response.status} when asked for a file's size`)
  return Number(response.headers.get('content-length'))
}

/** Removes a file. One that is already gone is fine. */
export async function deleteFile(config, key) {
  const response = await ask(config, 'DELETE', pathOf(key))
  if (!response.ok && response.status !== 404) throw new Error(`The bucket answered ${response.status} when asked to delete a file`)
}

/** Every file whose name starts with `prefix`. Our own names only, so nothing in them needs unescaping. */
export async function listFiles(config, prefix) {
  const files = []
  let token = null
  do {
    const response = await ask(config, 'GET', '/', { 'list-type': 2, prefix, ...(token ? { 'continuation-token': token } : {}) })
    if (!response.ok) throw new Error(`The bucket answered ${response.status} when asked for its files`)
    const xml = await response.text()
    for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      files.push({
        key: /<Key>([^<]*)<\/Key>/.exec(entry)?.[1] ?? '',
        bytes: Number(/<Size>(\d+)<\/Size>/.exec(entry)?.[1] ?? 0),
        modifiedMs: Date.parse(/<LastModified>([^<]*)<\/LastModified>/.exec(entry)?.[1] ?? ''),
      })
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null
  } while (token)
  return files
}
