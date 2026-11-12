import { canonicalRow, keyedDigest, keyedRowDigest, type LogicalValue, type VerificationRow } from '../canonical'
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
