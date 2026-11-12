import { createHmac, timingSafeEqual } from 'node:crypto'

export type LogicalValue = null | boolean | string | number | LogicalValue[] | { [key: string]: LogicalValue }
export type VerificationColumn = { name: string; type: string; value: LogicalValue }
export type VerificationRow = {
  entity: string
  tenantId: string
  organizationId: string | null
  identity: string[]
  columns: VerificationColumn[]
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

export function canonicalRow(row: VerificationRow): Buffer {
  if (!row.identity.length || !row.entity || !row.tenantId) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const names = row.columns.map((column) => column.name)
  if (new Set(names).size !== names.length) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return canonicalValue([
    'rotation-row-v1', row.entity, row.tenantId, row.organizationId, row.identity,
    [...row.columns].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0).map((column) => [column.name, column.type, column.value]),
  ])
}

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
