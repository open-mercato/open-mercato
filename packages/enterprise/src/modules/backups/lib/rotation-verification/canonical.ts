import { createHmac, timingSafeEqual } from 'node:crypto'

export type LogicalValue = null | boolean | string | number | LogicalValue[] | { [key: string]: LogicalValue }
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
  return frame('o', Buffer.concat(Object.keys(value).sort().map((key) => Buffer.concat([
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
  if (value === null) return 5
  if (typeof value === 'boolean') return 6
  if (typeof value === 'string') return 5 + Buffer.byteLength(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    return 5 + Buffer.byteLength(Object.is(value, -0) ? '-0' : String(value))
  }
  if (Array.isArray(value)) return 5 + value.reduce<number>((size, entry) => size + encodedSize(entry), 0)
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return 5 + Object.keys(value).sort().reduce((size, key) => size + encodedSize(key) + encodedSize(value[key]), 0)
}

function writeCanonical(value: LogicalValue, output: Buffer, offset: number): number {
  const type = value === null ? '0' : typeof value === 'boolean' ? 'b' : typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : Array.isArray(value) ? 'a' : 'o'
  output[offset] = type.charCodeAt(0); output.writeUInt32BE(encodedSize(value) - 5, offset + 1); offset += 5
  if (value === null) return offset
  if (typeof value === 'boolean') return offset + output.write(value ? '1' : '0', offset)
  if (typeof value === 'string') return offset + output.write(value, offset)
  if (typeof value === 'number') return offset + output.write(Object.is(value, -0) ? '-0' : String(value), offset)
  if (Array.isArray(value)) { for (const entry of value) offset = writeCanonical(entry, output, offset); return offset }
  for (const key of Object.keys(value).sort()) { offset = writeCanonical(key, output, offset); offset = writeCanonical(value[key], output, offset) }
  return offset
}

export function keyedRowDigest(key: Buffer, row: VerificationRow): string {
  const value = rowValue(row)
  const size = encodedSize(value)
  if (size > 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const encoded = Buffer.allocUnsafe(size)
  if (writeCanonical(value, encoded, 0) !== size) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const hmac = createHmac('sha256', key).update(frame('d', Buffer.from('row-v1')))
  hmac.update(encoded)
  return hmac.digest('hex')
}
