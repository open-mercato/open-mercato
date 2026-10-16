import { resolveStatusQueue } from './queue-status-registry'
import type { InspectedJobDto, JobInspectorResponse } from './queue-status.types'
import type { RecentJob } from '@open-mercato/queue'

/** Server-side hard cap — never trust a caller-supplied `limit` beyond this. */
const MAX_RECENT_JOBS_LIMIT = 100
const DEFAULT_RECENT_JOBS_LIMIT = 20

export type InspectorActorScope = {
  actorUserId: string | null
  tenantId: string | null
  isSuperAdmin: boolean
}

export type InspectorAuditWriter = {
  log: (input: {
    tenantId: string | null
    organizationId: string | null
    actorUserId: string | null
    resourceKind: string
    resourceId: string
    accessType: string
    context?: Record<string, unknown>
  }) => Promise<unknown>
}

export type InspectRecentJobsOptions = {
  queue: string
  state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  type?: string
  id?: string
  limit: number
  actor: InspectorActorScope
  /** Writes the audit record (#3105 R5). Every call writes one, even a zero-result call. */
  audit: InspectorAuditWriter
}

/**
 * Known-sensitive/credential-shaped key names, redacted wherever they appear
 * in a job payload tree, at any depth (#3105 Tier 2). Heuristic and
 * allow-list-based by design (see the spec's risk R2) — an unrecognized
 * sensitive key could still surface. This is deliberately NOT a general PII
 * scrubber: ordinary business fields (email, name, address) stay visible,
 * because an operator debugging "what did this job receive" needs them, and
 * this tier is already gated to platform-operator/superadmin and audited.
 * Mirrors the credential-class keys in
 * `packages/shared/src/lib/dev-runtime/redaction.ts` (a different mechanism —
 * that one regex-scrubs free text; this one walks a structured object by key).
 */
const SENSITIVE_KEY_PATTERN = /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|cookie|session[_-]?id|ssn|social[_-]?security|credit[_-]?card|card[_-]?number|cvv|bank[_-]?account|iban)/i

const REDACTED_MARKER = '«redacted»'
const MAX_REDACTION_DEPTH = 12

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) return REDACTED_MARKER
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_MARKER : redactValue(entryValue, depth + 1)
    }
    return result
  }
  return value
}

/** Redacts a job payload tree. Exported for direct unit testing. */
export function redactJobPayload(payload: unknown): unknown {
  return redactValue(payload, 0)
}

function extractJobTenant(job: RecentJob): { tenantId: string | null; organizationId: string | null } {
  const data = job.data
  if (!data || typeof data !== 'object') return { tenantId: null, organizationId: null }
  const envelope = data as { tenantId?: unknown; organizationId?: unknown }
  return {
    tenantId: typeof envelope.tenantId === 'string' ? envelope.tenantId : null,
    organizationId: typeof envelope.organizationId === 'string' ? envelope.organizationId : null,
  }
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(0, Math.min(n, max))
}

function toInspectedJob(job: RecentJob, tenantId: string | null, organizationId: string | null): InspectedJobDto {
  return {
    id: job.id,
    queue: job.queue,
    state: job.state,
    type: job.type,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    tenantId,
    organizationId,
    data: redactJobPayload(job.data),
  }
}

/**
 * Tier 2 Job Inspector (#3105). Enforces tenant isolation SERVER-SIDE before
 * anything leaves this function — this is the hard invariant the spec calls
 * out as critical (R1): a non-superadmin MUST NEVER see another tenant's job
 * or payload, even by a direct job id. Always writes an audit record, even
 * when the result is empty.
 */
export async function inspectRecentJobs(opts: InspectRecentJobsOptions): Promise<JobInspectorResponse> {
  const instance = resolveStatusQueue(opts.queue)
  const requestedLimit = clamp(opts.limit, DEFAULT_RECENT_JOBS_LIMIT, MAX_RECENT_JOBS_LIMIT)

  let rawJobs: RecentJob[] = []
  if (typeof instance.getRecentJobs === 'function') {
    if (opts.id) {
      rawJobs = await instance.getRecentJobs({ state: opts.state, id: opts.id, limit: 1 })
    } else {
      // Fetch the server's full bounded window (never the client-requested X) so the
      // tenant filter below has the maximum allowed pool to select from — the spec
      // requires `X` to apply AFTER the tenant filter, not narrow the raw fetch itself.
      // This still never enumerates the whole queue: it is capped at the same hard
      // ceiling the queue package itself enforces.
      rawJobs = await instance.getRecentJobs({
        state: opts.state,
        type: opts.type,
        limit: MAX_RECENT_JOBS_LIMIT,
      })
    }
  }

  const withTenant = rawJobs.map((job) => ({ job, scope: extractJobTenant(job) }))

  const visible = opts.actor.isSuperAdmin
    ? withTenant
    : withTenant.filter(({ scope }) => scope.tenantId !== null && scope.tenantId === opts.actor.tenantId)

  const bounded = visible.slice(0, requestedLimit)
  const jobs = bounded.map(({ job, scope }) => toInspectedJob(job, scope.tenantId, scope.organizationId))
  const crossTenant = opts.actor.isSuperAdmin

  // Audited before returning, per call, regardless of outcome (#3105 R5).
  await opts.audit.log({
    tenantId: opts.actor.tenantId,
    organizationId: null,
    actorUserId: opts.actor.actorUserId,
    resourceKind: 'queue.job',
    resourceId: opts.queue,
    accessType: 'configs.queues_status.inspect_payloads',
    context: {
      state: opts.state ?? null,
      type: opts.type ?? null,
      id: opts.id ?? null,
      requestedLimit,
      returnedCount: jobs.length,
      crossTenant,
    },
  })

  return { jobs, crossTenant }
}
