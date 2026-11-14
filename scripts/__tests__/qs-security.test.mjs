import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const qs = require('qs')

test('qs safely serializes comma arrays containing hostile toString properties', () => {
  for (const encodeValuesOnly of [false, true]) {
    const parsed = qs.parse('a[0][toString]=x', { allowPrototypes: true })
    assert.doesNotThrow(() => qs.stringify(parsed, { arrayFormat: 'comma', encodeValuesOnly }))
    assert.doesNotThrow(() => qs.stringify(JSON.parse('{"a":[{"toString":"x"}]}'), {
      arrayFormat: 'comma', encodeValuesOnly,
    }))
  }
})

test('qs safely round-trips an attacker-controlled isBuffer property', () => {
  const parsed = qs.parse('x[constructor][isBuffer]=y', { plainObjects: true })
  assert.equal(qs.stringify(parsed), 'x%5Bconstructor%5D%5BisBuffer%5D=y')
})

test('qs enforces comma array limits for bracket and plain keys', () => {
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }
  for (const query of ['a[]=1,2,3,4', 'a=1,2,3,4']) {
    assert.throws(() => qs.parse(query, options), RangeError)
  }
  assert.deepEqual(qs.parse('a[]=1,2,3', options), { a: [['1', '2', '3']] })
})

test('qs preserves ordinary parsing and serialization', () => {
  assert.deepEqual(qs.parse('filter[status]=open&ids[]=one&ids[]=two'), {
    filter: { status: 'open' }, ids: ['one', 'two'],
  })
  assert.equal(qs.stringify({ ids: ['one', 'two'] }, { arrayFormat: 'comma' }), 'ids=one%2Ctwo')
})
