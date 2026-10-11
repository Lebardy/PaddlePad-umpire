#!/usr/bin/env node
// ============================================================
// The bucket signer, with no network.
//
//   node server/scripts/check-bucket.mjs
//
// The read link is checked against the example Amazon publishes for
// this signing scheme ("Authenticating Requests: Using Query
// Parameters", bucket examplebucket, file test.txt, 24 May 2013): if
// our signature equals theirs, the key derivation, the canonical
// request and the string to sign are all right. The upload form is
// checked for what it promises. Talking to a real bucket is
// bucket-live.mjs.
// ============================================================

import { MAX_VIDEO_BYTES, bucketConfig, signedReadUrl, signedUploadForm } from '../src/bucket.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)

const amazon = {
  VIDEO_BUCKET: 'examplebucket', VIDEO_BUCKET_ENDPOINT: 'https://s3.amazonaws.com', VIDEO_BUCKET_REGION: 'us-east-1',
  VIDEO_BUCKET_KEY_ID: 'AKIAIOSFODNN7EXAMPLE', VIDEO_BUCKET_SECRET: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}
const then = new Date('2013-05-24T00:00:00Z')

section('settings')
{
  check('all five make a bucket', bucketConfig(amazon)?.host, 'examplebucket.s3.amazonaws.com')
  check('its address', bucketConfig(amazon)?.origin, 'https://examplebucket.s3.amazonaws.com')
  for (const key of Object.keys(amazon)) {
    check(`without ${key} video is off`, bucketConfig({ ...amazon, [key]: '' }), null)
  }
  check('nothing set at all is off', bucketConfig({}), null)
  check('an endpoint that is not a full address is off', bucketConfig({ ...amazon, VIDEO_BUCKET_ENDPOINT: 'storage.example.com' }), null)
  check('the size limit is 2 GB', MAX_VIDEO_BYTES, 2147483648)
}

section('a read link')
{
  const url = new URL(signedReadUrl(bucketConfig(amazon), 'test.txt', { seconds: 86400, now: then }))
  check('goes to the file', url.origin + url.pathname, 'https://examplebucket.s3.amazonaws.com/test.txt')
  check('names the scheme', url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
  check('names the key, day, region and service', url.searchParams.get('X-Amz-Credential'), 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request')
  check('carries its time', url.searchParams.get('X-Amz-Date'), '20130524T000000Z')
  check('and how long it lasts', url.searchParams.get('X-Amz-Expires'), '86400')
  check('signs only the host', url.searchParams.get('X-Amz-SignedHeaders'), 'host')
  check("its signature is Amazon's own for this example", url.searchParams.get('X-Amz-Signature'),
    'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
  check('two hours unless told otherwise',
    new URL(signedReadUrl(bucketConfig(amazon), 'test.txt', { now: then })).searchParams.get('X-Amz-Expires'), '7200')
  const odd = new URL(signedReadUrl(bucketConfig(amazon), "videos/a b/it's (1).mp4", { now: then }))
  check('a name with spaces and marks is escaped', odd.pathname, "/videos/a%20b/it%27s%20%281%29.mp4")
}

section('an upload form')
{
  const form = signedUploadForm(bucketConfig(amazon), 'videos/m1/abc.mp4', { bytes: 1000, now: then })
  check('is sent to the bucket', form.url, 'https://examplebucket.s3.amazonaws.com/')
  check('its fields, in order', Object.keys(form.fields),
    ['bucket', 'key', 'Content-Type', 'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'Policy', 'X-Amz-Signature'])
  check('fixes the name', form.fields.key, 'videos/m1/abc.mp4')
  check('fixes the type', form.fields['Content-Type'], 'video/mp4')
  const policy = JSON.parse(Buffer.from(form.fields.Policy, 'base64').toString('utf8'))
  check('is good for an hour', policy.expiration, '2013-05-24T01:00:00.000Z')
  check('allows exactly that size', policy.conditions.find((c) => Array.isArray(c)), ['content-length-range', 1000, 1000])
  check('and nothing else about the file is open',
    policy.conditions.filter((c) => !Array.isArray(c)).map((c) => Object.keys(c)[0]),
    ['bucket', 'key', 'Content-Type', 'x-amz-algorithm', 'x-amz-credential', 'x-amz-date'])
  check('the signature is 64 hex characters', /^[0-9a-f]{64}$/.test(form.fields['X-Amz-Signature']), true)
  const other = signedUploadForm(bucketConfig(amazon), 'videos/m1/abc.mp4', { bytes: 1001, now: then })
  check('a different size has a different signature', other.fields['X-Amz-Signature'] === form.fields['X-Amz-Signature'], false)
  const stranger = signedUploadForm(bucketConfig({ ...amazon, VIDEO_BUCKET_SECRET: 'not-the-secret' }), 'videos/m1/abc.mp4', { bytes: 1000, now: then })
  check('a different secret has a different signature', stranger.fields['X-Amz-Signature'] === form.fields['X-Amz-Signature'], false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
