#!/usr/bin/env node
// ============================================================
// Facility rules that need no database.
//
//   node server/scripts/check-facility-rules.mjs
// ============================================================

const rules = await import('../src/facility-rules.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`),
  )
}
const section = (title) => console.log(`\n${title}`)

section('fees')
{
  check('no fee', rules.feeText(null), 'Fee not set')
  check('zero is free', rules.feeText(0), 'Free')
  check('a whole fee has no decimals', rules.feeText(15000), '₱150 per hour')
  check('a fee with centavos keeps two decimals', rules.feeText(15050), '₱150.50 per hour')
  check('thousands get a comma', rules.feeText(100000), '₱1,000 per hour')
  check('pesos typed as a number', rules.pesosToCentavos(150), 15000)
  check('pesos typed as text', rules.pesosToCentavos(' 150.5 '), 15050)
  check('empty means not set', rules.pesosToCentavos(''), null)
  check('null means not set', rules.pesosToCentavos(null), null)
  check('negative is refused', rules.pesosToCentavos(-5), undefined)
  check('three decimals are refused', rules.pesosToCentavos('1.005'), undefined)
  check('words are refused', rules.pesosToCentavos('abc'), undefined)
  check('a peso sign and commas are allowed', rules.pesosToCentavos('₱1,200'), 120000)
}

section('reading facility details')
{
  const ok = rules.readFacility({
    name: '  Court Nine  ', area: ' Dumaguete ', locationUrl: 'https://maps.app.goo.gl/abc',
    openingHours: 'Mon–Sat 6am–10pm', hourlyFee: '150', details: '  Four courts.  ',
  })
  check('a full facility is read and trimmed', ok, { values: {
    name: 'Court Nine', area: 'Dumaguete', location_url: 'https://maps.app.goo.gl/abc',
    opening_hours: 'Mon–Sat 6am–10pm', hourly_fee_centavos: 15000, details: 'Four courts.',
  } })
  check('a name is required when creating', rules.readFacility({ name: '  ' }), { error: 'A facility needs a name (up to 80 characters)' })
  check('a long name is refused', rules.readFacility({ name: 'x'.repeat(81) }), { error: 'A facility needs a name (up to 80 characters)' })
  check('empty optional text becomes nothing', rules.readFacility({ name: 'A', area: '  ', details: '' }).values,
    { name: 'A', area: null, location_url: null, opening_hours: null, hourly_fee_centavos: null, details: null })
  check('a link must be https', rules.readFacility({ name: 'A', locationUrl: 'http://maps.example.com' }), { error: 'The map link must start with https://' })
  check('an over-long link gets its own message, not the https one',
    rules.readFacility({ name: 'A', locationUrl: `https://example.com/${'x'.repeat(490)}` }),
    { error: 'The map link can be up to 500 characters' })
  check('a long area is refused', rules.readFacility({ name: 'A', area: 'x'.repeat(121) }), { error: 'The area can be up to 120 characters' })
  check('long opening hours are refused', rules.readFacility({ name: 'A', openingHours: 'x'.repeat(201) }), { error: 'Opening hours can be up to 200 characters' })
  check('long details are refused', rules.readFacility({ name: 'A', details: 'x'.repeat(1001) }), { error: 'Details can be up to 1000 characters' })
  check('a bad fee is refused', rules.readFacility({ name: 'A', hourlyFee: '-1' }), { error: 'The fee must be an amount in pesos, like 150 or 150.50' })
  check('a partial change reads only what was sent', rules.readFacility({ hourlyFee: '200' }, { partial: true }), { values: { hourly_fee_centavos: 20000 } })
  check('a partial change can clear the link', rules.readFacility({ locationUrl: '' }, { partial: true }), { values: { location_url: null } })
  check('a partial change still checks the name', rules.readFacility({ name: '' }, { partial: true }), { error: 'A facility needs a name (up to 80 characters)' })
}

section('which columns a write may touch')
{
  check('every allowed column passes through', rules.facilityColumns({
    name: 'A', area: 'B', location_url: 'C', opening_hours: 'D', hourly_fee_centavos: 100, details: 'E',
  }), ['name', 'area', 'location_url', 'opening_hours', 'hourly_fee_centavos', 'details'])
  check('an unknown column is dropped', rules.facilityColumns({ name: 'A', created_by: 'x', id: 'y' }), ['name'])
  check('a raw body with only unknown keys yields nothing', rules.facilityColumns({ role: 'owner', facility_id: 'f1' }), [])
  check('no values at all yields nothing', rules.facilityColumns({}), [])
}

section('which columns an edit actually changed')
{
  const before = {
    name: 'Court Nine', area: 'Dumaguete', location_url: 'https://maps.example.com/a',
    opening_hours: 'Mon–Sat 6am–10pm', hourly_fee_centavos: 15000, details: 'Four courts.',
  }
  check('sending every field but changing only one names only that one',
    rules.changedFacilityColumns(before, { ...before, hourly_fee_centavos: 20000 }), ['hourly_fee_centavos'])
  check('sending every field unchanged names nothing',
    rules.changedFacilityColumns(before, { ...before }), [])
  check('a field sent but not part of the values object is ignored',
    rules.changedFacilityColumns(before, { name: 'Court Nine' }), [])
  check('several real changes are all named, in column order',
    rules.changedFacilityColumns(before, { ...before, name: 'Court Ten', details: 'Six courts.' }),
    ['name', 'details'])
  check('clearing an optional field to null counts as a change',
    rules.changedFacilityColumns(before, { ...before, area: null }), ['area'])
}

section('who may do what')
{
  const owner = { role: 'owner', facilityId: null }
  const adminA = { role: 'admin', facilityId: 'fa' }
  const adminNone = { role: 'admin', facilityId: null }
  check('the owner manages any facility', rules.mayManageFacility(owner, 'fb'), true)
  check('an admin manages their own facility', rules.mayManageFacility(adminA, 'fa'), true)
  check('an admin cannot manage another facility', rules.mayManageFacility(adminA, 'fb'), false)
  check('a facility-less admin manages no facility', rules.mayManageFacility(adminNone, 'fb'), false)
  check('the owner manages any umpire', rules.mayManageUmpire(owner, { facility_id: 'fb' }), true)
  check('an admin manages their own umpires', rules.mayManageUmpire(adminA, { facility_id: 'fa' }), true)
  check('an admin cannot manage another facility’s umpire', rules.mayManageUmpire(adminA, { facility_id: 'fb' }), false)
  check('an admin cannot manage an umpire with no facility', rules.mayManageUmpire(adminA, { facility_id: null }), false)
  check('a facility-less admin manages no umpire either', rules.mayManageUmpire(adminNone, { facility_id: 'fb' }), false)
  check('only the owner pauses players', [rules.mayPausePlayers(owner), rules.mayPausePlayers(adminA)], [true, false])
  check('only the owner creates facilities', [rules.mayCreateFacility(owner), rules.mayCreateFacility(adminA)], [true, false])
  check('only the owner moves people', [rules.mayMove(owner), rules.mayMove(adminA)], [true, false])
}

section('which facility a request is scoped to')
{
  const owner = { role: 'owner', facilityId: null }
  const adminA = { role: 'admin', facilityId: 'fa' }
  const adminNone = { role: 'admin', facilityId: null }
  check('the owner with nothing requested sees every facility', rules.facilityFilterFor(owner, null), { all: true })
  check('the owner requesting a facility is scoped to just it', rules.facilityFilterFor(owner, 'fb'), { id: 'fb' })
  check('a facility admin is scoped to their own facility', rules.facilityFilterFor(adminA, null), { id: 'fa' })
  check('a facility admin cannot pick another facility', rules.facilityFilterFor(adminA, 'fb'), { id: 'fa' })
  check('a facility-less admin sees and manages nothing', rules.facilityFilterFor(adminNone, null), { none: true })
  check('a facility-less admin cannot pick a facility either', rules.facilityFilterFor(adminNone, 'fb'), { none: true })
}

section('what the site sees')
{
  check('a facility as the site sees it', rules.facilityPayload({
    id: 'f1', name: 'Court Nine', area: 'Dumaguete', location_url: null, opening_hours: null,
    hourly_fee_centavos: 15000, details: null, created_at: '2026-09-19T00:00:00Z', updated_at: '2026-09-19T00:00:00Z',
  }), {
    id: 'f1', name: 'Court Nine', area: 'Dumaguete', locationUrl: null, openingHours: null,
    hourlyFeeCentavos: 15000, feeText: '₱150 per hour', details: null,
    createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z',
  })
  check('the starting facility name', rules.STARTING_FACILITY_NAME, 'Starting facility')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
