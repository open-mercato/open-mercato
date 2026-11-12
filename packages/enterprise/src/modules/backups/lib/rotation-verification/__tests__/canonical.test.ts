import { ExactJsonNumber, canonicalValue, canonicalRow, keyedDigest, keyedRowDigest, type LogicalValue, type VerificationRow } from '../canonical'
const key = Buffer.alloc(32, 7)
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
