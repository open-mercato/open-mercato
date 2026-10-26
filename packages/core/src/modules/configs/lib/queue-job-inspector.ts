import { redactDevRuntimeText } from '@open-mercato/shared/lib/dev-runtime/redaction'
import { resolveStatusQueue } from './queue-status-registry'
import { withQueueReadTimeout } from './queue-status'
import { QUEUE_STATUS_ERROR_CODES, reportQueueStatusError } from './queue-status-telemetry'
import type { InspectedJobDto, JobInspectorResponse } from './queue-status.types'
import type { RecentJob } from '@open-mercato/queue'

/** Server-side hard cap — never trust a caller-supplied `limit` beyond this. */
const MAX_RECENT_JOBS_LIMIT = 100
const DEFAULT_RECENT_JOBS_LIMIT = 20

export type InspectorActorScope = {
  actorUserId: string | null
  tenantId: string | null
  /** The actor's selected organization — recorded on the access-log row so it stays visible under an org filter. */
  organizationId?: string | null
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

function readScopeId(source: unknown, key: 'tenantId' | 'organizationId'): string | null | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[key]
  if (typeof value === 'string' && value.length > 0) return value
  if (value === null) return null
  return undefined
}

/**
 * Picks the one value two envelope locations agree on. Absent locations are ignored; two present
 * locations that disagree make the field ambiguous, which resolves to "unknown" — never to either
 * candidate — so a conflicting payload cannot choose which tenant it is shown to.
 */
function reconcile(candidates: Array<string | null | undefined>): string | null {
  const present = candidates.filter((candidate): candidate is string | null => candidate !== undefined)
  const concrete = new Set(present.filter((candidate): candidate is string => candidate !== null))
  if (concrete.size !== 1) return null
  // A location that explicitly says "no value" next to one that names a value is a conflict too.
  if (present.some((candidate) => candidate === null)) return null
  return [...concrete][0]
}

/**
 * Normalizes the supported producer envelopes into one ownership pair: a top-level
 * `{ tenantId, organizationId }` (most queues) and a nested `{ scope: { tenantId, organizationId } }`
 * (communication_channels inbound). A job whose owner cannot be established is unowned and is only
 * ever visible to a superadmin.
 */
function extractJobTenant(job: RecentJob): { tenantId: string | null; organizationId: string | null } {
  const data = job.data
  if (!data || typeof data !== 'object') return { tenantId: null, organizationId: null }
  const nested = (data as { scope?: unknown }).scope
  const tenantId = reconcile([readScopeId(data, 'tenantId'), readScopeId(nested, 'tenantId')])
  // An organization only means something inside an established tenant.
  const organizationId = tenantId
    ? reconcile([readScopeId(data, 'organizationId'), readScopeId(nested, 'organizationId')])
    : null
  return { tenantId, organizationId }
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
    // Raw failure text can echo credentials; it is only reachable here, behind the tenant filter,
    // and is scrubbed with the same rules the dev-runtime reports use.
    failedReason: redactDevRuntimeText(job.failedReason, 500),
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
    // Bounded: with the backend down the strategy's reads can hang rather than fail.
    if (opts.id) {
      // No `state` here: for a direct id the queue reports the job's actual state.
      rawJobs = await withQueueReadTimeout(opts.queue, instance.getRecentJobs({ id: opts.id, limit: 1 }))
    } else {
      // Fetch the server's full bounded window (never the client-requested X) so the
      // tenant filter below has the maximum allowed pool to select from — the spec
      // requires `X` to apply AFTER the tenant filter, not narrow the raw fetch itself.
      // This still never enumerates the whole queue: it is capped at the same hard
      // ceiling the queue package itself enforces.
      rawJobs = await withQueueReadTimeout(
        opts.queue,
        instance.getRecentJobs({
          state: opts.state,
          type: opts.type,
          limit: MAX_RECENT_JOBS_LIMIT,
        }),
      )
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
  try {
    await opts.audit.log({
      tenantId: opts.actor.tenantId,
      organizationId: opts.actor.organizationId ?? null,
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
  } catch (auditError) {
    // Fail closed: payloads never leave without their access-log row. Reported, then rethrown.
    reportQueueStatusError(auditError, QUEUE_STATUS_ERROR_CODES.auditFailed, { queue: opts.queue })
    throw auditError
  }

  return { jobs, crossTenant }
}
