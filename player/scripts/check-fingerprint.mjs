#!/usr/bin/env node
// The fingerprint's geometry: node --test scripts/check-fingerprint.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reach, outline } from '../src/lib/fingerprint.js'

const corner = { mean: 1, spread: 0.5, out: 'lower' }
test('the average sits half way out', () => assert.equal(reach(1, corner), 0.5))
test('one spread better is a quarter further, whichever way the word points', () => {
  assert.equal(reach(0.5, corner), 0.75)
  assert.equal(reach(1.5, { ...corner, out: 'higher' }), 0.75)
})
test('far past either end stays on the chart', () => {
  assert.equal(reach(100, { ...corner, out: 'higher' }), 1)
  assert.equal(reach(-100, { ...corner, out: 'higher' }), 0.06)
})
test('nothing recorded or no spread gives no point', () => {
  assert.equal(reach(null, corner), null)
  assert.equal(reach(1, { ...corner, spread: 0 }), null)
})
test('six points, first at the top', () => {
  const pts = outline([1, 1, 1, 1, 1, 1], { cx: 100, cy: 100, r: 50 }).split(' ')
  assert.equal(pts.length, 6)
  assert.equal(pts[0], '100.0,50.0')
})
