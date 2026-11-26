import { randomBytes } from 'node:crypto'
import { validateCacheProviderNamespace } from '@open-mercato/cache/provider'

export const RECORD_FORMAT_VERSION = 1

export type StoredRecord = {
  v: typeof RECORD_FORMAT_VERSION
  n: string
  t: string[]
  e: number | null
  c: number
  f: 't' | 'b'
  p: string
}

export type EncodedPayload = string | Buffer

export function igniteCacheName(cacheNamePrefix: string, namespace: string): string {
  return `${cacheNamePrefix}${validateCacheProviderNamespace(namespace)}`
}

export function createRecordNonce(): string {
  return randomBytes(9).toString('base64url')
}

export function buildStoredRecord(input: {
  payload: EncodedPayload
  tags: ReadonlyArray<string> | undefined
  ttl: number | undefined
  now: number
  nonce?: string
}): StoredRecord {
  const binary = typeof input.payload !== 'string'
  return {
    v: RECORD_FORMAT_VERSION,
    n: input.nonce ?? createRecordNonce(),
    t: Array.from(new Set(input.tags ?? [])),
    e: typeof input.ttl === 'number' && Number.isFinite(input.ttl) && input.ttl > 0 ? input.now + input.ttl : null,
    c: input.now,
    f: binary ? 'b' : 't',
    p: binary ? Buffer.from(input.payload).toString('base64') : (input.payload as string),
  }
}

export function serializeStoredRecord(record: StoredRecord): string {
  return JSON.stringify(record)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function parseStoredRecord(raw: unknown): StoredRecord | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.v !== RECORD_FORMAT_VERSION) return null
  if (typeof candidate.n !== 'string' || !isStringArray(candidate.t)) return null
  if (candidate.e !== null && typeof candidate.e !== 'number') return null
  if (typeof candidate.c !== 'number') return null
  if (candidate.f !== 't' && candidate.f !== 'b') return null
  if (typeof candidate.p !== 'string') return null
  return {
    v: RECORD_FORMAT_VERSION,
    n: candidate.n,
    t: candidate.t,
    e: candidate.e,
    c: candidate.c,
    f: candidate.f,
    p: candidate.p,
  }
}

export function storedRecordPayload(record: StoredRecord): EncodedPayload {
  return record.f === 'b' ? Buffer.from(record.p, 'base64') : record.p
}

export function isStoredRecordExpired(record: StoredRecord, now: number): boolean {
  return record.e !== null && record.e <= now
}

export function storedRecordHasAnyTag(record: StoredRecord, tags: ReadonlySet<string>): boolean {
  return record.t.some((tag) => tags.has(tag))
}
