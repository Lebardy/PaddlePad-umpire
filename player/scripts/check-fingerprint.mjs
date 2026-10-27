#!/usr/bin/env node
// The fingerprint's geometry: node --test scripts/check-fingerprint.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reach, outline, labelSpot } from '../src/lib/fingerprint.js'

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
test('words sit above or below their corner and stay inside the chart', () => {
  const box = { cx: 195, cy: 190, r: 112 }
  const spots = [0, 1, 2, 3, 4, 5].map((i) => labelSpot(i, box))
  assert.ok(spots[0].y < box.cy - box.r && spots[3].y > box.cy + box.r)
  const vy = (i) => box.cy + box.r * Math.sin(((-90 + i * 60) * Math.PI) / 180)
  assert.ok([1, 5].every((i) => spots[i].y < vy(i)) && [2, 4].every((i) => spots[i].y > vy(i)))
  assert.ok(spots[1].x > 195 + box.r * Math.cos(Math.PI / 6) && spots[5].x < 195 - box.r * Math.cos(Math.PI / 6))
  assert.ok(spots.every((s) => s.x > 60 && s.x < 330))
})
