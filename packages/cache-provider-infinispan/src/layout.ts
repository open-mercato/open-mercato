import { createHash } from 'node:crypto'

export const LAYOUT_VERSION = 'v1'
export const RECORD_FORMAT = 1

export type EntryRecord = {
  writeId: string
  tags: string[]
  expiresAt: number | null
  encoding: 'text' | 'base64'
  payload: string
}

export type TagMember = {
  writeId: string
  writtenAt: number
  expiresAt: number | null
}

export type TagShard = Map<string, TagMember>

export function namespacePrefix(namespace: string): string {
  return `${namespace}:${LAYOUT_VERSION}:`
}

export function entryKeyPrefix(namespace: string): string {
  return `${namespacePrefix(namespace)}k:`
}

export function tagKeyPrefix(namespace: string): string {
  return `${namespacePrefix(namespace)}t:`
}

export function entryKey(namespace: string, physicalKey: string): string {
  return `${entryKeyPrefix(namespace)}${physicalKey}`
}

export function physicalKeyFromEntryKey(namespace: string, storedKey: string): string | null {
  const prefix = entryKeyPrefix(namespace)
  return storedKey.startsWith(prefix) ? storedKey.slice(prefix.length) : null
}

export function isNamespaceKey(namespace: string, storedKey: string): boolean {
  return storedKey.startsWith(namespacePrefix(namespace))
}

export function tagShardIndex(physicalKey: string, shards: number): number {
  if (shards <= 1) return 0
  return createHash('sha1').update(physicalKey).digest().readUInt32BE(0) % shards
}

export function tagShardKey(namespace: string, tag: string, shard: number, shards: number): string {
  return `${tagKeyPrefix(namespace)}${shards}:${shard}:${tag}`
}

export function tagShardKeysFor(namespace: string, tag: string, shards: number): string[] {
  return Array.from({ length: shards }, (_, shard) => tagShardKey(namespace, tag, shard, shards))
}

export function encodeEntryRecord(record: EntryRecord): string {
  return JSON.stringify({
    f: RECORD_FORMAT,
    w: record.writeId,
    t: record.tags,
    x: record.expiresAt,
    e: record.encoding === 'base64' ? 'b' : 't',
    d: record.payload,
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function decodeEntryRecord(raw: unknown): EntryRecord | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.f !== RECORD_FORMAT) return null
  if (typeof candidate.w !== 'string' || !isStringArray(candidate.t)) return null
  if (candidate.x !== null && typeof candidate.x !== 'number') return null
  if (candidate.e !== 't' && candidate.e !== 'b') return null
  if (typeof candidate.d !== 'string') return null
  return {
    writeId: candidate.w,
    tags: candidate.t,
    expiresAt: candidate.x,
    encoding: candidate.e === 'b' ? 'base64' : 'text',
    payload: candidate.d,
  }
}

export function encodeTagShard(shard: TagShard): string {
  const members: Record<string, [string, number, number | null]> = {}
  for (const [key, member] of shard) members[key] = [member.writeId, member.writtenAt, member.expiresAt]
  return JSON.stringify({ f: RECORD_FORMAT, m: members })
}

export function decodeTagShard(raw: unknown): TagShard | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.f !== RECORD_FORMAT || typeof candidate.m !== 'object' || candidate.m === null || Array.isArray(candidate.m)) return null
  const shard: TagShard = new Map()
  for (const [key, value] of Object.entries(candidate.m as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length !== 3) return null
    const [writeId, writtenAt, expiresAt] = value as unknown[]
    if (typeof writeId !== 'string' || typeof writtenAt !== 'number') return null
    if (expiresAt !== null && typeof expiresAt !== 'number') return null
    shard.set(key, { writeId, writtenAt, expiresAt })
  }
  return shard
}

export function isMemberReclaimable(member: TagMember, now: number, graceMs: number): boolean {
  return member.expiresAt !== null && member.expiresAt + graceMs < now
}

export function tagShardLifespanMs(shard: TagShard, now: number, graceMs: number): number | null {
  let latest = 0
  for (const member of shard.values()) {
    if (member.expiresAt === null) return null
    if (member.expiresAt > latest) latest = member.expiresAt
  }
  return Math.max(1, latest + graceMs - now)
}
