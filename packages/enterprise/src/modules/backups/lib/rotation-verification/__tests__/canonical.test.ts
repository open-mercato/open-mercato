import { ExactJsonNumber, canonicalValue, canonicalRow, keyedDigest, keyedRowDigest, type LogicalValue, type VerificationRow } from '../canonical'
const key = Buffer.alloc(32, 7)
test.each([
  ['row-v1', '73b579e02a286f290f02c9d3e1d49d402052d85930fa02da643b8fe531598e68'],
  ['metadata-v1', 'c979e0fc0880ef77feb173b93665d31b9c73c292c7b2d7e3f3e502be4348e01f'],
  ['metadata-intent-v1', 'e6800c07566f60233bf6e24c24699e9fa7c6bb59d9a863f1b1201339fdc70365'],
  ['intent-address-v1', '0a7c286bf356cefcf963046f2c3ffa905b8667eb35b0c94e75bffe7a9b5e6116'],
  ['intent-page-anchor-v1', 'eefe3aa0536f406d2683bdcaec604e366ad997a5407cf7c705331780b3cc3d5c'],
  ['dek-material-v1', 'f8d915fe449b30f26053ee8bd6b3fa1831c41e0ea9febdf094a9e12faa7f954a'],
  ['checkpoint-record-v1', '29d644084d0955dab0ffb63458018ae6d792d1d84b8b83c264201ff9af5ca52f'],
  ['checkpoint-tail-v1', 'f49428bb924600303039f7c14d23904bb96129717f6ce6b78675093f12a524be'],
  ['verification-failure-v1', 'cf6f1623269151eb7ae6ab72136d2a552588fde836b06a39fc658b1afa72781d'],
  ['custom-domain-42', '10329f64ddeb1767fd1665b67956f1f8a00bf975ed19ff08395b3025aa19272f'],
])('domain %s preserves the versioned HMAC-SHA256 binary golden vector', (domain, expected) => {
  const input = Buffer.from([0, 255, 1, 128, 34, 10])
  expect(keyedDigest(key, domain, input)).toBe(expected)
  // Reuse cannot retain a caller's message or key between invocations.
  keyedDigest(Buffer.alloc(32, 9), domain, Buffer.from('different input'))
  expect(keyedDigest(key, domain, input)).toBe(expected)
})
function row(value: LogicalValue): VerificationRow {
  return { entity: 'public.fixture', tenantId: 'tenant', organizationId: null, identity: ['1'], columns: [{ name: 'value', type: 'jsonb', value }] }
}
test('single-pass payload backfilling preserves frames for nested large multibyte values', () => {
  let value: LogicalValue = '日本語😀'.repeat(8192)
  for (let depth = 0; depth < 16; depth++) value = { null: null, array: [false, -0, value], z: depth }
  const candidate = row(value)
  expect(keyedRowDigest(key, candidate)).toBe(keyedDigest(key, 'row-v1', canonicalRow(candidate)))
})
test('framed row byte limit includes metadata and rejects oversized UTF-8 payloads', () => {
  expect(() => keyedRowDigest(key, row('😀'.repeat(262144)))).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  expect(keyedRowDigest(key, row('x'.repeat(1024 * 1024 - 1024)))).toHaveLength(64)
})


test('exact JSON numbers normalize notation without colliding with objects or rounded decimals', () => {
  expect(canonicalValue(new ExactJsonNumber('1.000'))).toEqual(canonicalValue(new ExactJsonNumber('1e0')))
  expect(canonicalValue(new ExactJsonNumber('-0'))).toEqual(canonicalValue(new ExactJsonNumber('0.0')))
  expect(canonicalValue(new ExactJsonNumber('1.0000000000000000001'))).not.toEqual(canonicalValue(new ExactJsonNumber('1')))
  expect(canonicalValue(new ExactJsonNumber('9007199254740993'))).not.toEqual(canonicalValue(new ExactJsonNumber('9007199254740992')))
  expect(canonicalValue(new ExactJsonNumber('1'))).not.toEqual(canonicalValue({ source: '1', canonical: '+:1:0' }))
})


test('ill-formed UTF-16 cannot collide with a valid replacement character in UTF-8 frames', () => {
  const high = String.fromCharCode(0xd800), low = String.fromCharCode(0xdc00)
  const replacement = String.fromCharCode(0xfffd)
  expect(high).not.toBe(replacement)
  expect(Buffer.from(high).equals(Buffer.from(replacement))).toBe(true)
  for (const value of [high, low, { text: high }, { [low]: 'value' }, [high]]) {
    expect(() => canonicalValue(value)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect(() => keyedRowDigest(key, row(value))).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  }
  expect(keyedRowDigest(key, row(replacement))).toHaveLength(64)
  expect(keyedRowDigest(key, row(String.fromCodePoint(0x1f600)))).toHaveLength(64)
})
