import { createHmac, timingSafeEqual } from 'node:crypto'

export class ExactJsonNumber {
  readonly canonical: string
  constructor(readonly source: string) {
    const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source)
    if (!match || (match[4]?.length ?? 0) > 16) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '')
    const significant = digits.replace(/0+$/, '')
    const exponent = BigInt(match[4] ?? '0') - BigInt(match[3]?.length ?? 0) + BigInt(digits.length - significant.length)
    this.canonical = significant ? `${match[1] || '+'}:${significant}:${exponent}` : '0'
  }
}

export type LogicalValue = ExactJsonNumber | null | boolean | string | number | LogicalValue[] | { [key: string]: LogicalValue }
export type VerificationColumn = { name: string; type: string; value: LogicalValue }
export type VerificationRow = {
  entity: string
  tenantId: string
  organizationId: string | null
  identity: string[]
  columns: VerificationColumn[]
  metadata?: { [key: string]: LogicalValue }
  metadataIntent?: { before: { [key: string]: LogicalValue }; after: { [key: string]: LogicalValue }; mac: string }
}

function frame(type: string, bytes: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([Buffer.from(type), length, bytes])
}

export function canonicalValue(value: LogicalValue): Buffer {
  if (value instanceof ExactJsonNumber) return frame('j', Buffer.from(value.canonical))
  if (value === null) return frame('0', Buffer.alloc(0))
  if (typeof value === 'boolean') return frame('b', Buffer.from(value ? '1' : '0'))
  if (typeof value === 'string') return frame('s', Buffer.from(value))
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    }
    return frame('n', Buffer.from(Object.is(value, -0) ? '-0' : String(value)))
  }
  if (Array.isArray(value)) return frame('a', Buffer.concat(value.map(canonicalValue)))
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  }
  return frame('o', Buffer.concat(Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map((key) => Buffer.concat([
    canonicalValue(key), canonicalValue(value[key]),
  ]))))
}

export function rowIdentity(row: VerificationRow): string {
  return JSON.stringify([row.entity, row.tenantId, row.organizationId, row.identity])
}

function rowValue(row: VerificationRow): LogicalValue {
  if (!row.identity.length || !row.entity || !row.tenantId) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const names = row.columns.map((column) => column.name)
  if (new Set(names).size !== names.length) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return [
    'rotation-row-v1', row.entity, row.tenantId, row.organizationId, row.identity,
    [...row.columns].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0).map((column) => [column.name, column.type, column.value]),
  ]
}

export function canonicalRow(row: VerificationRow): Buffer { return canonicalValue(rowValue(row)) }

export function keyedDigest(key: Buffer, domain: string, input: Buffer | string): string {
  return createHmac('sha256', key).update(frame('d', Buffer.from(domain))).update(input).digest('hex')
}

export function keyFingerprint(runKey: Buffer, dek: string): string {
  const bytes = Buffer.from(dek, 'base64')
  if (bytes.length !== 32) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return keyedDigest(runKey, 'dek-material-v1', bytes)
}

export function sameDigest(expected: string, actual: string): boolean {
  return /^[0-9a-f]{64}$/.test(expected) && /^[0-9a-f]{64}$/.test(actual)
    && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

function encodedSize(value: LogicalValue): number {
  if (value instanceof ExactJsonNumber) return 5 + Buffer.byteLength(value.canonical)
  if (value === null) return 5
  if (typeof value === 'boolean') return 6
  if (typeof value === 'string') return 5 + Buffer.byteLength(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    return 5 + Buffer.byteLength(Object.is(value, -0) ? '-0' : String(value))
  }
  if (Array.isArray(value)) return 5 + value.reduce<number>((size, entry) => size + encodedSize(entry), 0)
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return 5 + Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).reduce((size, key) => size + encodedSize(key) + encodedSize(value[key]), 0)
}

function writeCanonical(value: LogicalValue, output: Buffer, offset: number): number {
  const start = offset
  const type = value instanceof ExactJsonNumber ? 'j' : value === null ? '0' : typeof value === 'boolean' ? 'b' : typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : Array.isArray(value) ? 'a' : 'o'
  output[offset] = type.charCodeAt(0); offset += 5
  if (value instanceof ExactJsonNumber) offset += output.write(value.canonical, offset)
  else if (value === null) { /* Empty payload; length is filled below. */ }
  else if (typeof value === 'boolean') offset += output.write(value ? '1' : '0', offset)
  else if (typeof value === 'string') offset += output.write(value, offset)
  else if (typeof value === 'number') offset += output.write(Object.is(value, -0) ? '-0' : String(value), offset)
  else if (Array.isArray(value)) { for (const entry of value) offset = writeCanonical(entry, output, offset) }
  else { for (const key of Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) { offset = writeCanonical(key, output, offset); offset = writeCanonical(value[key], output, offset) } }
  // Backfill the payload length after writing it once; recursively measuring every
  // ancestor would rescan large UTF-8 values once for each nesting level.
  output.writeUInt32BE(offset - start - 5, start + 1)
  return offset
}

export function keyedRowDigestAndSize(key: Buffer, row: VerificationRow): { digest: string; bytes: number } {
  const value = rowValue(row)
  const size = encodedSize(value)
  if (size > 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const encoded = Buffer.allocUnsafe(size)
  if (writeCanonical(value, encoded, 0) !== size) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const hmac = createHmac('sha256', key).update(frame('d', Buffer.from('row-v1')))
  hmac.update(encoded)
  return { digest: hmac.digest('hex'), bytes: size }
}

export function keyedRowDigest(key: Buffer, row: VerificationRow): string { return keyedRowDigestAndSize(key, row).digest }
