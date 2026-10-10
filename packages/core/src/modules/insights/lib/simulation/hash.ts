import { createHash } from 'node:crypto'
import { compareCodeUnits } from '../process/registry'

const HOUR_MS = 60 * 60 * 1000

/**
 * Canonical JSON: object keys sorted by code units, `undefined`/functions dropped, dates as ISO
 * strings, non-finite numbers as null. Stable across processes, so it can feed a hash.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>()) ?? 'null'
}

function serialize(value: unknown, ancestors: Set<object>): string | undefined {
  if (value === null) return 'null'
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString())
  if (typeof value !== 'object') return undefined
  if (ancestors.has(value)) throw new TypeError('[internal] Cannot canonicalize a circular structure')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((item) => serialize(item, ancestors) ?? 'null').join(',')}]`
    const record = value as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(record).sort(compareCodeUnits)) {
      const serialized = serialize(record[key], ancestors)
      if (serialized === undefined) continue
      entries.push(`${JSON.stringify(key)}:${serialized}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function floorToUtcHour(value: Date): string {
  return new Date(Math.floor(value.getTime() / HOUR_MS) * HOUR_MS).toISOString()
}

export type SimulationInputsHashSource = {
  kind: string
  proposal: unknown
  artifactKind: string
  artifactId: string | null
  artifactVersion: { updatedAt: string | null; fingerprint: string | null } | null
  windowFrom: Date
  windowTo: Date
  engineVersion: number
  contributionVersion: number
  requesterUserId: string
  organizationId: string
}

/**
 * S11: `sha256(kind, proposal, artifact version, absolute window rounded to the UTC hour,
 * engine_version, contribution version, requester user id, organization id)`. The requester is
 * part of the hash, so one user's run is never handed to another through deduplication.
 */
export function computeSimulationInputsHash(source: SimulationInputsHashSource): string {
  const canonical = canonicalJson({
    kind: source.kind,
    proposal: source.proposal,
    artifact: {
      kind: source.artifactKind,
      id: source.artifactId,
      updatedAt: source.artifactVersion?.updatedAt ?? null,
      fingerprint: source.artifactVersion?.fingerprint ?? null,
    },
    window: { from: floorToUtcHour(source.windowFrom), to: floorToUtcHour(source.windowTo) },
    engineVersion: source.engineVersion,
    contributionVersion: source.contributionVersion,
    requesterUserId: source.requesterUserId.toLowerCase(),
    organizationId: source.organizationId.toLowerCase(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/** UTF-8 byte length of the JSON of a value (the `input_json` size limit). */
export function jsonByteLength(value: unknown): number {
  const json = JSON.stringify(value === undefined ? null : value)
  return Buffer.byteLength(json ?? 'null', 'utf8')
}

/** Nesting depth of arrays/objects (a scalar is 0); stops counting past `limit`. */
export function jsonDepth(value: unknown, limit: number): number {
  let maxDepth = 0
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    const { node, depth } = current
    if (node === null || typeof node !== 'object') continue
    const nextDepth = depth + 1
    if (nextDepth > maxDepth) maxDepth = nextDepth
    if (maxDepth > limit) return maxDepth
    const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>)
    for (const child of children) {
      if (child !== null && typeof child === 'object') stack.push({ node: child, depth: nextDepth })
    }
  }
  return maxDepth
}
