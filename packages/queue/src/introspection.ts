/**
 * Shared, strategy-independent helpers for the payload-free queue introspection
 * contract (Queue Status Dashboard, #3105). Nothing here touches I/O.
 */

import type { QueuedJob } from './types'

/** Hard cap on how far a caller may page into a window. */
export const MAX_INTROSPECTION_OFFSET = 1000
/** How many candidates a strategy inspects when a job-type filter forces post-filtering. */
export const MAX_TYPE_FILTER_CANDIDATES = 200
const MAX_JOB_TYPE_LENGTH = 128

/**
 * Thrown by a strategy when an optional introspection read cannot be served
 * within its documented bounds (for example a local queue file too large to scan
 * cheaply). Callers treat it as "this section is unavailable", never as "empty".
 */
export class QueueIntrospectionUnavailableError extends Error {
  readonly code = 'queue.introspection_unavailable'

  constructor(message = '[internal] Queue introspection is unavailable for this queue') {
    super(message)
    this.name = 'QueueIntrospectionUnavailableError'
  }
}

/**
 * Resolves a requested window size. `undefined` / non-finite falls back to the
 * default; zero and negative values resolve to `0`, which callers MUST treat as
 * an empty window *before* talking to the backend (BullMQ reads range `0..-1`
 * as "everything").
 */
export function resolveWindowSize(value: number | undefined, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(0, Math.min(n, max))
}

/** Offsets are never negative, never fractional and never unbounded. */
export function resolveOffset(value: number | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, Math.min(n, MAX_INTROSPECTION_OFFSET))
}

function readStringField(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_JOB_TYPE_LENGTH) return undefined
  return trimmed
}

/**
 * The payload-free job type of a stored job: the `jobType` stamped into the
 * envelope metadata at enqueue time, falling back to the producer's own
 * `payload.jobType` discriminator (the same field `removeQueuedJobsByScope`
 * already scopes on). The BullMQ job *name* is deliberately NOT used — enqueue
 * names every job with its random UUID.
 */
export function resolveJobType(envelope: Pick<QueuedJob<unknown>, 'payload' | 'metadata'> | undefined): string | undefined {
  if (!envelope) return undefined
  return readStringField(envelope.metadata, 'jobType') ?? readStringField(envelope.payload, 'jobType')
}

/**
 * Stable, payload-free failure codes exposed on the broadly-granted Tier 1
 * surface. Raw failure text can carry tenant data or credentials from the
 * handler's exception, so it is classified here and never forwarded.
 */
export const QUEUE_FAILURE_CODES = [
  'queue.job_stalled',
  'queue.job_start_limit',
  'queue.timeout',
  'queue.connection_error',
  'queue.handler_error',
] as const
export type QueueFailureCode = (typeof QUEUE_FAILURE_CODES)[number]

/**
 * Maps a raw failure reason to a safe code. The raw text is only ever matched
 * against, never returned. Returns `undefined` when there is no reason at all.
 */
export function classifyFailureReason(reason: string | undefined | null): QueueFailureCode | undefined {
  if (typeof reason !== 'string' || reason.length === 0) return undefined
  if (reason === 'job stalled more than allowable limit') return 'queue.job_stalled'
  if (reason === 'job started more than allowable limit') return 'queue.job_start_limit'
  if (/\b(timed? ?out|timeout|ETIMEDOUT|deadline exceeded)\b/i.test(reason)) return 'queue.timeout'
  if (/\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up)\b/i.test(reason)) {
    return 'queue.connection_error'
  }
  return 'queue.handler_error'
}

/** Max length of a raw failure reason kept for the privileged Tier 2 read. */
export const MAX_RAW_FAILED_REASON_LENGTH = 500

/**
 * Reduces a completed job's envelope to the minimum a retained completed record
 * needs: ownership (tenant / organization) and the job type — no business data.
 * Used so bounded completed-job retention (needed for processing-time metrics)
 * never keeps handler payloads around.
 */
export function buildCompletedRetentionEnvelope<T>(envelope: QueuedJob<T>): QueuedJob<unknown> {
  const payload = envelope.payload as unknown
  const kept: Record<string, unknown> = {}
  if (payload && typeof payload === 'object') {
    const source = payload as Record<string, unknown>
    for (const key of ['tenantId', 'organizationId', 'jobType'] as const) {
      if (typeof source[key] === 'string') kept[key] = source[key]
      else if (key === 'organizationId' && source[key] === null) kept[key] = null
    }
    const scope = source.scope
    if (scope && typeof scope === 'object') {
      const nested: Record<string, unknown> = {}
      for (const key of ['tenantId', 'organizationId'] as const) {
        const value = (scope as Record<string, unknown>)[key]
        if (typeof value === 'string' || value === null) nested[key] = value
      }
      if (Object.keys(nested).length > 0) kept.scope = nested
    }
  }
  const jobType = resolveJobType(envelope)
  if (jobType && kept.jobType === undefined) kept.jobType = jobType
  return {
    id: envelope.id,
    payload: kept,
    createdAt: envelope.createdAt,
    ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
  }
}
