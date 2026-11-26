import { createHash } from 'node:crypto'

export const LAYOUT_VERSION = 'v1'
export const BUCKET_FORMAT_VERSION = 1
/** Per-item bytes memcached spends on its header, key and CAS beyond the value. */
export const ITEM_OVERHEAD_BYTES = 192

const WRAPPER_RECORD_PATTERN = /^(.*):key:(?:k|meta):([0-9a-f]{64})$/

export type StoredEntry = {
  /** Encoded payload produced by the host codec. */
  p: string
  /** 1 when `p` is base64 of a binary (compressed) frame. */
  b?: 1
  /** Scoped tags. */
  t: string[]
  /** Logical expiry in epoch milliseconds, or null. */
  x: number | null
  /** Creation time in epoch milliseconds. */
  c: number
}

export type BucketEntries = Map<string, StoredEntry>

/**
 * Physical bucket item key: `{namespace}:v1:b{bucketCount}:{index}`. The
 * bucket count is part of the key so a changed count starts a fresh layout
 * instead of reading entries routed by a different modulus.
 */
export function bucketItemKey(namespace: string, bucketCount: number, index: number): string {
  return `${namespace}:${LAYOUT_VERSION}:b${bucketCount}:${index}`
}

export function allBucketItemKeys(namespace: string, bucketCount: number): string[] {
  return Array.from({ length: bucketCount }, (_, index) => bucketItemKey(namespace, bucketCount, index))
}

/**
 * Routing identity of a physical key. The tenant wrapper stores a value record
 * (`…:key:k:<hash>`) and a metadata record (`…:key:meta:<hash>`) per logical
 * entry; both route to the same bucket so eviction removes them together.
 */
export function routingKey(physicalKey: string): string {
  const match = WRAPPER_RECORD_PATTERN.exec(physicalKey)
  return match ? `${match[1]}:key:${match[2]}` : physicalKey
}

export function bucketIndexFor(physicalKey: string, bucketCount: number): number {
  const digest = createHash('sha256').update(routingKey(physicalKey), 'utf8').digest()
  return digest.readUInt32BE(0) % bucketCount
}

export function bucketItemKeyFor(namespace: string, bucketCount: number, physicalKey: string): string {
  return bucketItemKey(namespace, bucketCount, bucketIndexFor(physicalKey, bucketCount))
}

function isStoredEntry(value: unknown): value is StoredEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.p === 'string'
    && (record.b === undefined || record.b === 1)
    && Array.isArray(record.t)
    && record.t.every((tag) => typeof tag === 'string')
    && (record.x === null || typeof record.x === 'number')
    && typeof record.c === 'number'
}

/** Returns null for an item that is not a readable bucket of this layout. */
export function decodeBucket(raw: Buffer): BucketEntries | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (record.v !== BUCKET_FORMAT_VERSION || typeof record.e !== 'object' || record.e === null || Array.isArray(record.e)) return null
  const entries: BucketEntries = new Map()
  for (const [key, entry] of Object.entries(record.e as Record<string, unknown>)) {
    if (isStoredEntry(entry)) entries.set(key, entry)
  }
  return entries
}

export function encodeBucket(entries: BucketEntries): Buffer {
  const body: Record<string, StoredEntry> = {}
  for (const [key, entry] of entries) body[key] = entry
  return Buffer.from(JSON.stringify({ v: BUCKET_FORMAT_VERSION, e: body }), 'utf8')
}

export function estimateEntryBytes(key: string, entry: StoredEntry): number {
  return Buffer.byteLength(JSON.stringify(key), 'utf8') + Buffer.byteLength(JSON.stringify(entry), 'utf8') + 2
}

export const BUCKET_ENVELOPE_BYTES = Buffer.byteLength(JSON.stringify({ v: BUCKET_FORMAT_VERSION, e: {} }), 'utf8')

export function isEntryExpired(entry: StoredEntry, now: number): boolean {
  return entry.x !== null && entry.x <= now
}

/**
 * Drops the oldest routing groups (value + metadata pairs) not listed in
 * `protectedRoutes` until the encoded bucket fits `limitBytes`. Returns the
 * encoded bucket and the number of physical records evicted, or null when the
 * protected entries alone exceed the limit.
 */
export function fitBucket(
  entries: BucketEntries,
  limitBytes: number,
  protectedRoutes: ReadonlySet<string>,
): { buffer: Buffer; evicted: number } | null {
  let buffer = encodeBucket(entries)
  if (buffer.length <= limitBytes) return { buffer, evicted: 0 }
  const groups = new Map<string, { keys: string[]; newest: number; bytes: number }>()
  for (const [key, entry] of entries) {
    const route = routingKey(key)
    if (protectedRoutes.has(route)) continue
    const group = groups.get(route) ?? { keys: [], newest: 0, bytes: 0 }
    group.keys.push(key)
    group.newest = Math.max(group.newest, entry.c)
    group.bytes += estimateEntryBytes(key, entry)
    groups.set(route, group)
  }
  const ordered = Array.from(groups.values()).sort((left, right) => left.newest - right.newest)
  let excess = buffer.length - limitBytes
  let evicted = 0
  for (const group of ordered) {
    for (const key of group.keys) entries.delete(key)
    evicted += group.keys.length
    excess -= group.bytes
    if (excess <= 0) {
      buffer = encodeBucket(entries)
      if (buffer.length <= limitBytes) return { buffer, evicted }
      excess = buffer.length - limitBytes
    }
  }
  buffer = encodeBucket(entries)
  return buffer.length <= limitBytes ? { buffer, evicted } : null
}
