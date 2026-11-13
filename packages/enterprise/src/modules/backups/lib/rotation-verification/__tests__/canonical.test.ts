import { createHmac } from 'node:crypto'
import { ExactJsonNumber, canonicalValue, canonicalRow, encodeRowDigestFrame, rowDigestDomainPrefix, keyedDigest, keyedRowDigest, type LogicalValue, type VerificationRow } from '../canonical'
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

// Independent prior codec: recursive framing/concatenation is intentionally kept
// here so production encoder refactors cannot redefine their own expected bytes.
function oldCanonical(value: LogicalValue): Buffer {
  const frame = (tag: string, payload: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(payload.length)
    return Buffer.concat([Buffer.from(tag), length, payload])
  }
  if (value instanceof ExactJsonNumber) return frame('j', Buffer.from(value.canonical))
  if (value === null) return frame('0', Buffer.alloc(0))
  if (typeof value === 'boolean') return frame('b', Buffer.from(value ? '1' : '0'))
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('ROTATION_COVERAGE_UNSUPPORTED')
    return frame('s', Buffer.from(value))
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('ROTATION_COVERAGE_UNSUPPORTED')
    return frame('n', Buffer.from(Object.is(value, -0) ? '-0' : String(value)))
  }
  if (Array.isArray(value)) return frame('a', Buffer.concat(value.map(oldCanonical)))
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('ROTATION_COVERAGE_UNSUPPORTED')
  return frame('o', Buffer.concat(Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map(name => Buffer.concat([oldCanonical(name), oldCanonical(value[name])]))))
}
function oldRow(candidate: VerificationRow): Buffer {
  if (new Set(candidate.columns.map(column => column.name)).size !== candidate.columns.length) throw new Error('ROTATION_COVERAGE_UNSUPPORTED')
  return oldCanonical([
    'rotation-row-v1', candidate.entity, candidate.tenantId, candidate.organizationId, candidate.identity,
    [...candidate.columns].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0).map(column => [column.name, column.type, column.value]),
  ])
}
test('single-allocation values preserve independent prior frames across nested typed metadata and Unicode', () => {
  const special = Object.assign(Object.create(null), { constructor: 'value', ['__proto__']: null, '日本語😀': [true, -0, new ExactJsonNumber('1.0000000000000000001')] }) as LogicalValue
  const values: LogicalValue[] = [null, false, true, '', '\u0000\n\"\\日本語😀\ufffd', -0, 0, 0.125, Number.MAX_SAFE_INTEGER, new ExactJsonNumber('-2.50e-12'), special,
    { z: [null, [false, { '\uffff': 'last', '\u{10000}': 'supplementary', a: ['nested', 3] }]], before: { updated_at: null }, after: { updated_at: '2026-01-01T00:00:00.123456Z' } },
  ]
  for (const value of values) expect(canonicalValue(value)).toEqual(oldCanonical(value))
  let nested: LogicalValue = special
  for (let depth = 0; depth < 24; depth++) nested = { z: depth, a: [nested, null] }
  expect(canonicalValue(nested)).toEqual(oldCanonical(nested))
})
test('generic canonical values retain prior admissible sizes above the row-only one-MiB cap', () => {
  const value = '日本語'.repeat(120000)
  const expected = oldCanonical(value)
  expect(expected.length).toBeGreaterThan(1024 * 1024)
  expect(canonicalValue(value)).toEqual(expected)
  expect(() => keyedRowDigest(key, row(value))).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
})
test.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('both codecs reject unsupported numeric value %s', value => {
  expect(() => oldCanonical({ value })).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  expect(() => canonicalValue({ value })).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  expect(() => keyedRowDigest(key, row(value))).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
})
test('single allocation retains non-plain-prototype rejection', () => {
  for (const value of [new Date(), Buffer.from('bytes'), Object.create({ inherited: true })] as unknown as LogicalValue[]) {
    expect(() => oldCanonical(value)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect(() => canonicalValue(value)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect(() => keyedRowDigest(key, row(value))).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  }
})
test('strictly ordered and unsorted columns preserve prior row frames without modifying caller arrays', () => {
  const columns = Object.freeze([
    Object.freeze({ name: '', type: 'text', value: 'empty name' }),
    Object.freeze({ name: 'a', type: 'jsonb', value: { nested: [new ExactJsonNumber('1e0'), null] } }),
    Object.freeze({ name: '日本語', type: 'text', value: '😀' }),
  ])
  for (const order of [[...columns], [columns[2], columns[0], columns[1]]]) {
    const original = [...order]
    const candidate = { ...row(null), columns: order }
    const expected = oldRow(candidate)
    expect(canonicalRow(candidate)).toEqual(expected)
    expect(keyedRowDigest(key, candidate)).toBe(keyedDigest(key, 'row-v1', expected))
    expect(candidate.columns).toEqual(original)
  }
})
test('adjacent and unsorted repeated column names cannot enter the strict-order fast path', () => {
  const column = { name: 'a', type: 'text', value: 'value' }
  for (const columns of [[column, { ...column }], [column, { ...column, name: 'z' }, { ...column }]]) {
    const candidate = { ...row(null), columns }
    expect(() => oldRow(candidate)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect(() => canonicalRow(candidate)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect(() => keyedRowDigest(key, candidate)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  }
})
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

test('transferable row frames preserve exact old HMAC bytes without sharing Buffer pools', () => {
  const pooled = Buffer.allocUnsafe(128); pooled.fill(0xa5)
  const snapshot = Buffer.from(pooled)
  for (const value of [null, '', '\u0000\ufeff\ufffd日本語🙂', new ExactJsonNumber('9007199254740993.00001'), { nested: [true, null, 'value'] }]) {
    const input = row(value)
    const encoded = encodeRowDigestFrame(input)
    expect(encoded.frame).toBeInstanceOf(ArrayBuffer)
    expect(encoded.bytes).toBe(encoded.frame.byteLength)
    expect(Buffer.from(encoded.frame)).toEqual(canonicalRow(input))
    expect(createHmac('sha256', key).update(rowDigestDomainPrefix()).update(Buffer.from(encoded.frame)).digest('hex')).toBe(keyedRowDigest(key, input))
    const moved = structuredClone(encoded.frame, { transfer: [encoded.frame] })
    expect(encoded.frame.byteLength).toBe(0)
    expect(moved.byteLength).toBe(encoded.bytes)
    expect(pooled).toEqual(snapshot)
  }
  const first = rowDigestDomainPrefix(); first.fill(0)
  expect(Buffer.from(rowDigestDomainPrefix()).toString('hex')).toBe('6400000006726f772d7631')
  expect(() => encodeRowDigestFrame(row('x'.repeat(1024 * 1024)))).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
})
