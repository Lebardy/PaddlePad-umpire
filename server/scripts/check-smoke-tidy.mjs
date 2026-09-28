#!/usr/bin/env node
// ============================================================
// What the smoke tidy route accepts.
//
//   node server/scripts/check-smoke-tidy.mjs
//
// The deletes themselves are checked by the smoke run on staging; this
// pins the request reader, which is what stands between a bad body and
// a DELETE.
// ============================================================

import { readTidyRequest } from '../src/smoke-tidy.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

check('an empty body removes nothing',
  readTidyRequest({}),
  { values: { umpireIds: [], adminIds: [], facilityIds: [], playerIds: [], inviteCodes: [], nightsOf: null, activityOf: null } })
check('lists and the nights owner are read, repeats dropped',
  readTidyRequest({ umpireIds: [A, A], adminIds: [B], facilityIds: [], playerIds: [A], inviteCodes: ['K7Q2', 'K7Q2'], nightsOf: B, activityOf: A }),
  { values: { umpireIds: [A], adminIds: [B], facilityIds: [], playerIds: [A], inviteCodes: ['K7Q2'], nightsOf: B, activityOf: A } })
check('a list that is not a list is refused',
  readTidyRequest({ umpireIds: A }).error, 'umpireIds must be a list of ids')
check('a non-id in a list is refused',
  readTidyRequest({ playerIds: [A, "x' OR 1=1"] }).error, 'playerIds must be a list of ids')
check('too many ids are refused',
  readTidyRequest({ facilityIds: Array(2001).fill(A) }).error, 'facilityIds must be a list of ids')
check('an empty invite code is refused',
  readTidyRequest({ inviteCodes: [''] }).error, 'inviteCodes must be a list of codes')
check('an activity owner that is not an id is refused',
  readTidyRequest({ activityOf: 42 }).error, 'activityOf must be an admin id')
check('a nights owner that is not an id is refused',
  readTidyRequest({ nightsOf: 'everyone' }).error, 'nightsOf must be an umpire id')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
