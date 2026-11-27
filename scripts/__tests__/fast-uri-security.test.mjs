import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import semver from 'semver'
import { parse } from 'yaml'

const require = createRequire(import.meta.url)
const requireAjv = createRequire(require.resolve('ajv'))
const uri = requireAjv('fast-uri')

const advisoryRanges = {
  'GHSA-w74x-v6f9-j3xg': '>=3.0.0 <3.1.9',
  'GHSA-xhq7-xmqj-769h': '>=3.0.0 <3.1.9',
  'GHSA-wjr9-j795-jxcr': '>=3.1.3 <3.1.9',
  'GHSA-333x-w4r6-6crp': '>=3.0.0 <3.1.9',
  'GHSA-hrr3-gc8f-f4qj': '>=3.0.0 <3.1.8',
}

test('every locked fast-uri version and the AJV child exclude targeted advisory ranges', async () => {
  const lockfile = parse(await readFile(new URL('../../yarn.lock', import.meta.url), 'utf8'))
  const lockedVersions = Object.entries(lockfile)
    .filter(([descriptor]) => descriptor.startsWith('fast-uri@'))
    .map(([, entry]) => entry.version)
  assert.ok(lockedVersions.length > 0)
  for (const version of [...lockedVersions, requireAjv('fast-uri/package.json').version]) {
    for (const [advisory, range] of Object.entries(advisoryRanges)) {
      assert.equal(semver.satisfies(version, range, { includePrerelease: true }), false, `${advisory}: ${version}`)
    }
  }
})

test('encoded schemes stay malformed instead of becoming executable schemes', () => {
  for (const source of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
    assert.ok(uri.parse(source).error)
    assert.notEqual(uri.parse(source).scheme, 'javascript')
    assert.notEqual(uri.normalize(source), 'javascript:alert(1)')
    assert.throws(() => uri.resolve('https://example.test/', source), /scheme is malformed/)
  }
  assert.equal(uri.equal('%68ttp://a/', 'http://a/'), false)
})

test('relative-reference normalization preserves the resolved resource', () => {
  for (const reference of ['a/../b', '../x']) {
    const base = 'https://example.test/one/two/'
    assert.equal(uri.resolve(base, uri.normalize(reference)), uri.resolve(base, reference))
  }
  assert.equal(uri.equal('a/../b', '/b'), false)
})

test('malformed HTTP authorities are rejected instead of silently rewritten', () => {
  for (const source of ['http://a@b@evil.example/', 'http://evil\t.example/', 'http://evil\r.example/', 'http://evil\n.example/']) {
    assert.ok(uri.parse(source).error, source)
  }
})

test('suffix serialization escapes a colon in the first relative path segment', () => {
  for (const path of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)']) {
    const serialized = uri.serialize({ path }, { reference: 'suffix' })
    assert.equal(uri.parse(serialized).scheme, undefined)
    assert.match(serialized, /%3A/i)
  }
})

test('encoded host octets use the same lowercase identity as ordinary hosts', () => {
  assert.equal(uri.parse('//%41.com').host, 'a.com')
  assert.equal(uri.normalize('//%41.com'), '//a.com')
  assert.equal(uri.equal('//%41.com', '//a.com'), true)
})

test('AJV continues resolving ordinary external schema references', () => {
  const Ajv = require('ajv')
  const ajv = new Ajv()
  ajv.addSchema({ $id: 'https://example.test/schemas/name.json', type: 'string', minLength: 1 })
  const validate = ajv.compile({
    $id: 'https://example.test/schemas/record.json',
    type: 'object',
    properties: { name: { $ref: 'name.json' } },
    required: ['name'],
  })
  assert.equal(validate({ name: 'valid' }), true)
  assert.equal(validate({ name: '' }), false)
})
