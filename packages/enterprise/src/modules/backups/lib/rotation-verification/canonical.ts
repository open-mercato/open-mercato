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

// Public protocol prefixes only: never cache keys, messages or dynamic domains.
// These private buffers are read by HMAC.update and cannot escape to callers.
const fixedDomainFrames = new Map([
  'row-v1', 'metadata-v1', 'metadata-intent-v1', 'intent-address-v1',
  'intent-page-anchor-v1', 'dek-material-v1', 'checkpoint-record-v1',
  'checkpoint-tail-v1', 'verification-failure-v1',
].map(domain => [domain, frame('d', Buffer.from(domain))]))
function domainFrame(domain: string): Buffer {
  return fixedDomainFrames.get(domain) ?? frame('d', Buffer.from(domain))
}

function wellFormedText(value: string): string {
  // UTF-8 replacement would otherwise collapse a lone surrogate and U+FFFD.
  if (!value.isWellFormed()) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return value
}

export function canonicalValue(value: LogicalValue): Buffer {
  // Metadata/intents use the same frames as rows, without the row-specific cap.
  const size = encodedSize(value)
  const encoded = Buffer.allocUnsafe(size)
  if (writeCanonical(value, encoded, 0) !== size) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return encoded
}

export function rowIdentity(row: VerificationRow): string {
  return JSON.stringify([row.entity, row.tenantId, row.organizationId, row.identity])
}

function rowValue(row: VerificationRow): LogicalValue {
  if (!row.identity.length || !row.entity || !row.tenantId) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  let columns = row.columns
  let previous: string | undefined
  for (const column of columns) {
    if (typeof column.name !== 'string' || (previous !== undefined && previous >= column.name)) {
      const names = columns.map((entry) => entry.name)
      if (new Set(names).size !== names.length) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
      columns = [...columns].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      break
    }
    previous = column.name
  }
  return [
    'rotation-row-v1', row.entity, row.tenantId, row.organizationId, row.identity,
    columns.map((column) => [column.name, column.type, column.value]),
  ]
}

export function canonicalRow(row: VerificationRow): Buffer { return canonicalValue(rowValue(row)) }

export function keyedDigest(key: Buffer, domain: string, input: Buffer | string): string {
  return createHmac('sha256', key).update(domainFrame(domain)).update(input).digest('hex')
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

type EncodingPlan = { payloadLengths: number[]; hasLargeLeaf: boolean }

function encodedSize(value: LogicalValue, plan?: EncodingPlan): number {
  const position = plan?.payloadLengths.length ?? 0
  plan?.payloadLengths.push(0)
  let size: number
  if (value instanceof ExactJsonNumber) size = 5 + Buffer.byteLength(value.canonical)
  else if (value === null) size = 5
  else if (typeof value === 'boolean') size = 6
  else if (typeof value === 'string') size = 5 + Buffer.byteLength(wellFormedText(value))
  else if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    size = 5 + Buffer.byteLength(Object.is(value, -0) ? '-0' : String(value))
  } else if (Array.isArray(value)) size = 5 + value.reduce<number>((total, entry) => total + encodedSize(entry, plan), 0)
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    size = 5 + Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).reduce((total, name) => total + encodedSize(name, plan) + encodedSize(value[name], plan), 0)
  }
  if (plan) {
    plan.payloadLengths[position] = size - 5
    if ((value instanceof ExactJsonNumber || typeof value === 'string') && size - 5 > 2048) plan.hasLargeLeaf = true
  }
  return size
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

function updateCoalesced(hmac: ReturnType<typeof createHmac>, value: LogicalValue, payloadLengths: readonly number[], expectedSize: number): void {
  const scratch = Buffer.allocUnsafe(4096)
  let used = 0
  let position = 0
  let emitted = 0
  const flush = () => {
    if (used) { hmac.update(scratch.subarray(0, used)); used = 0 }
  }
  const header = (tag: string, length: number) => {
    if (used + 5 > scratch.length) flush()
    scratch[used] = tag.charCodeAt(0)
    scratch.writeUInt32BE(length, used + 1)
    used += 5
    emitted += 5
  }
  const leaf = (text: string, bytes: number) => {
    if (bytes > 2048) { flush(); hmac.update(text, 'utf8') }
    else {
      if (used + bytes > scratch.length) flush()
      const written = scratch.write(text, used)
      if (written !== bytes) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
      used += written
    }
    emitted += bytes
  }
  const visit = (entry: LogicalValue): void => {
    const length = payloadLengths[position++]
    if (length === undefined) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    if (entry instanceof ExactJsonNumber) { header('j', length); leaf(entry.canonical, length) }
    else if (entry === null) header('0', length)
    else if (typeof entry === 'boolean') { header('b', length); leaf(entry ? '1' : '0', length) }
    else if (typeof entry === 'string') { header('s', length); leaf(entry, length) }
    else if (typeof entry === 'number') { header('n', length); leaf(Object.is(entry, -0) ? '-0' : String(entry), length) }
    else if (Array.isArray(entry)) { header('a', length); for (const child of entry) visit(child) }
    else {
      header('o', length)
      for (const name of Object.keys(entry).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) { visit(name); visit(entry[name]) }
    }
  }
  try {
    visit(value)
    flush()
    if (position !== payloadLengths.length || emitted !== expectedSize) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  } finally { scratch.fill(0) }
}

export function keyedRowDigestAndSize(key: Buffer, row: VerificationRow): { digest: string; bytes: number } {
  const value = rowValue(row)
  const plan: EncodingPlan = { payloadLengths: [], hasLargeLeaf: false }
  const size = encodedSize(value, plan)
  if (size > 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const hmac = createHmac('sha256', key).update(domainFrame('row-v1'))
  if (plan.hasLargeLeaf) updateCoalesced(hmac, value, plan.payloadLengths, size)
  else {
    const encoded = Buffer.allocUnsafe(size)
    if (writeCanonical(value, encoded, 0) !== size) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    hmac.update(encoded)
  }
  return { digest: hmac.digest('hex'), bytes: size }
}

export function keyedRowDigest(key: Buffer, row: VerificationRow): string { return keyedRowDigestAndSize(key, row).digest }
