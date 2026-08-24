import { getModules } from '@open-mercato/shared/lib/modules/registry'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import { z, type ZodTypeAny } from 'zod'

export type SchedulerSafeQueueTarget = {
  queue: string
  /**
   * Indicative primary owner — the first registry module found among the
   * queue's consumers. A queue may legitimately have consumers from more than
   * one module; ownership for provenance checks is always resolved per module.
   */
  moduleId: string
  /** Extra creator features a principal must hold to schedule onto this queue. */
  requiredFeatures: string[]
}

export type TrustedScheduleScope = {
  tenantId: string | null
  organizationId: string | null
}

/**
 * Runtime payload schemas for opted-in scheduler targets.
 *
 * Worker metadata cannot carry a Zod schema through static registry generation,
 * so the module that owns a schedulable worker registers its target payload
 * schema here at bootstrap. Targets without a registered schema accept
 * arbitrary JSON payloads (documented escape hatch, mirroring scheduler-safe
 * commands which also carry no payload schema).
 */
const registeredPayloadSchemas = new Map<string, ZodTypeAny>()

export function registerSchedulerQueuePayloadSchema(queue: string, schema: ZodTypeAny): void {
  registeredPayloadSchemas.set(queue, schema)
}

export function getSchedulerQueuePayloadSchema(queue: string): ZodTypeAny | null {
  return registeredPayloadSchemas.get(queue) ?? null
}

export type SchedulerTargetRbacService = {
  userHasAllFeatures?: (
    userId: string,
    required: readonly string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

/**
 * Creator-side authorization for an opted-in queue target (#5213): a principal
 * must hold every feature the target declares beyond `scheduler.jobs.manage`.
 * Super administrators bypass target-specific checks, mirroring the rest of
 * the scheduler's authorization model. Returns null when authorized,
 * otherwise a short reason string.
 */
export async function assertSchedulerQueueTargetAuthorized(params: {
  queue: string
  actorUserId?: string | null
  tenantId?: string | null
  organizationId?: string | null
  isSuperAdmin?: boolean
  rbacService?: SchedulerTargetRbacService | null
}): Promise<string | null> {
  const requiredFeatures = getSchedulerQueueRequiredFeatures(params.queue)
  if (requiredFeatures.length === 0) return null
  if (params.isSuperAdmin === true) return null

  const actorUserId = typeof params.actorUserId === 'string' ? params.actorUserId.trim() : ''
  if (!actorUserId) return 'Scheduler queue target requires an authenticated creator'
  if (typeof params.rbacService?.userHasAllFeatures !== 'function') {
    return 'Scheduler queue target authorization is unavailable'
  }

  const authorized = await params.rbacService.userHasAllFeatures(actorUserId, requiredFeatures, {
    tenantId: params.tenantId ?? null,
    organizationId: params.organizationId ?? null,
  })
  if (!authorized) {
    return `Scheduler queue target requires features the creator lacks: ${requiredFeatures.join(', ')}`
  }
  return null
}

/**
 * Validates an author-supplied target payload against the target's registered
 * schema, when one exists. Returns null when the payload is acceptable,
 * otherwise a short reason string.
 */
export function validateSchedulerTargetPayload(
  queue: string,
  targetPayload: Record<string, unknown> | null | undefined,
): string | null {
  const schema = getSchedulerQueuePayloadSchema(queue)
  if (!schema) return null
  const result = schema.safeParse(targetPayload ?? {})
  if (result.success) return null
  const firstIssue = result.error.issues[0]
  return [
    firstIssue?.path?.length ? `${firstIssue.path.join('.')}: ` : '',
    firstIssue?.message ?? 'Invalid payload',
  ].join('')
}

/**
 * Keys a schedule author may never control on a dispatched target payload:
 * tenant/organization authority context and the reserved `_`-prefixed envelope
 * namespace (idempotency keys, dispatch-origin markers, …).
 */
const RESERVED_PAYLOAD_KEYS = new Set(['tenantId', 'organizationId', 'scope'])

function isReservedPayloadKey(key: string): boolean {
  return RESERVED_PAYLOAD_KEYS.has(key) || key.startsWith('_')
}

function stripReservedKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (isReservedPayloadKey(key)) continue
    if (key === 'payload' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = stripReservedKeys(value as Record<string, unknown>)
      continue
    }
    result[key] = value
  }
  return result
}

/**
 * Rebuild the trusted scope for a dispatched schedule payload from the stored
 * schedule row. Callers must never trust scope-shaped data from the schedule
 * author's `targetPayload`.
 */
export function buildTrustedScheduleScope(schedule: {
  tenantId?: string | null
  organizationId?: string | null
}): TrustedScheduleScope {
  return {
    tenantId: schedule.tenantId ?? null,
    organizationId: schedule.organizationId ?? null,
  }
}

/**
 * Sanitize an author-supplied schedule target payload before dispatch:
 * deep-copies it, strips reserved authority and `_`-prefixed envelope keys at
 * the payload root and inside the local-strategy `payload` wrapper level, then
 * injects the trusted scope derived from the schedule row.
 */
export function sanitizeSchedulerTargetPayload(
  targetPayload: Record<string, unknown> | null | undefined,
  schedule: Parameters<typeof buildTrustedScheduleScope>[0],
): Record<string, unknown> {
  const source = targetPayload ?? {}
  const cloned = structuredClone(source)
  const stripped = stripReservedKeys(cloned)
  return {
    ...stripped,
    scope: buildTrustedScheduleScope(schedule),
  }
}

const queueConsumerCache = new WeakMap<object, Map<string, ModuleWorker[]>>()

function collectQueueConsumers(): Map<string, ModuleWorker[]> {
  let modules: ReturnType<typeof getModules>
  try {
    modules = getModules()
  } catch {
    return new Map()
  }
  // The registry returns the same array instance between registrations, so the
  // grouped map can be memoized per instance instead of rebuilt per lookup.
  const cached = queueConsumerCache.get(modules)
  if (cached) return cached

  const byQueue = new Map<string, ModuleWorker[]>()
  for (const mod of modules) {
    for (const worker of mod.workers ?? []) {
      if (!worker.queue) continue
      const consumers = byQueue.get(worker.queue) ?? []
      consumers.push(worker)
      byQueue.set(worker.queue, consumers)
    }
  }
  queueConsumerCache.set(modules, byQueue)
  return byQueue
}

/**
 * Enumerate queue targets that are safe for user-facing scheduling (#5213):
 * every worker consuming the queue must explicitly opt in — queue consumers
 * compete for the same jobs, so a single non-opted-in consumer would otherwise
 * receive scheduler-controlled payloads it never agreed to accept.
 */
export function listSchedulerSafeQueueTargets(): SchedulerSafeQueueTarget[] {
  const targets: SchedulerSafeQueueTarget[] = []
  for (const [queue, consumers] of collectQueueConsumers()) {
    const optedIn = consumers.filter((worker) => worker.schedulerSafe === true)
    if (optedIn.length === 0 || optedIn.length !== consumers.length) continue

    const requiredFeatures = [...new Set(optedIn.flatMap((worker) => (
      Array.isArray(worker.schedulerRequiredFeatures) ? worker.schedulerRequiredFeatures : []
    )))]
    const ownerModuleIds = [...new Set(consumers.map((worker) => (
      typeof worker.id === 'string' ? (worker.id.split(':')[0] ?? '') : ''
    )))]
    targets.push({ queue, moduleId: ownerModuleIds[0] ?? '', requiredFeatures })
  }
  targets.sort((a, b) => a.queue.localeCompare(b.queue))
  return targets
}

export function isSchedulerSafeQueue(queue: string | null | undefined): boolean {
  if (!queue) return false
  return listSchedulerSafeQueueTargets().some((target) => target.queue === queue)
}

/**
 * Extra creator features required by the target queue beyond
 * `scheduler.jobs.manage` (#5213). Empty when the target declares none.
 */
export function getSchedulerQueueRequiredFeatures(queue: string): string[] {
  return listSchedulerSafeQueueTargets().find((target) => target.queue === queue)?.requiredFeatures ?? []
}

/**
 * The module ids that own workers on this queue, from the live registry.
 */
function findQueueOwnerModuleIds(queue: string): Set<string> {
  const owners = new Set<string>()
  for (const [candidate, consumers] of collectQueueConsumers()) {
    if (candidate !== queue) continue
    for (const worker of consumers) {
      if (typeof worker.id === 'string') owners.add(worker.id.split(':')[0] ?? '')
    }
  }
  return owners
}

/**
 * Operator-facing audit for persisted module-authored queue rows (#5213).
 *
 * Provenance on pre-upgrade rows is not fully verifiable at rest: a row created
 * by a non-user-bound API key carries no acting-user stamp, making it
 * indistinguishable from a genuine module registration. This helper surfaces
 * every module-authored queue-target row with its current dispatch verdict so
 * operators can review the allowed ones against their known integrations
 * (`mercato scheduler audit-queue-targets`).
 */
export type SchedulerModuleQueueRowAudit = {
  scheduleId: string
  name?: string
  sourceModule: string | null
  targetQueue: string | null
  isEnabled: boolean
  /** Whether the dispatch guard currently lets this row fire. */
  dispatchAllowed: boolean
}

export function auditSchedulerModuleQueueRows(
  rows: ReadonlyArray<{
    id: string
    name?: string | null
    targetQueue?: string | null
    sourceType?: string | null
    sourceModule?: string | null
    createdByUserId?: string | null
    isEnabled?: boolean
  }>,
): SchedulerModuleQueueRowAudit[] {
  return rows
    .filter((row) => row.sourceType === 'module' && row.targetQueue)
    .map((row) => ({
      scheduleId: row.id,
      name: row.name ?? undefined,
      sourceModule: row.sourceModule ?? null,
      targetQueue: row.targetQueue ?? null,
      isEnabled: row.isEnabled !== false,
      dispatchAllowed: canDispatchScheduleQueueTarget(row),
    }))
}

/**
 * Dispatch-time authorization for queue-targeted schedules (#5213).
 *
 * Provenance is server-owned and verified, never trusted from the stored row:
 * - API-authored schedules (`sourceType: 'user'`) may only target queues whose
 *   workers all opted into scheduling.
 * - Module-authored schedules are accepted only when the recorded
 *   `sourceModule` owns the queue in the live registry AND the row carries no
 *   acting-user stamp (`createdByUserId == null`) — `schedulerService.register()`
 *   never stamps one while every interactive API write does. Residual limit: a
 *   pre-upgrade row authored by a non-user-bound API key also lacks the stamp;
 *   surface those with `auditSchedulerModuleQueueRows` /
 *   `mercato scheduler audit-queue-targets`.
 */
export function canDispatchScheduleQueueTarget(schedule: {
  targetQueue?: string | null
  sourceType?: string | null
  sourceModule?: string | null
  /** Server-stamped actor on API-authored rows; module registration never sets it. */
  createdByUserId?: string | null
}): boolean {
  if (!schedule.targetQueue) return false
  if (schedule.sourceType === 'module') {
    // Provenance must be server-owned, and both stored fields were client-
    // writable before #5213. A matching sourceModule alone is forgeable public
    // knowledge, so a persisted module row is only trusted when it also carries
    // no acting-user stamp: `schedulerService.register()` never sets one, while
    // every API write does. Forged pre-upgrade rows fail closed here.
    if (!schedule.sourceModule) return false
    if (schedule.createdByUserId) return false
    return findQueueOwnerModuleIds(schedule.targetQueue).has(schedule.sourceModule)
  }
  return isSchedulerSafeQueue(schedule.targetQueue)
}

// Built-in opted-in target owned by this module: the side-effect-free QA echo
// queue. The strict shape keeps scheduler-controlled payloads predictable and
// gives deployments a working reference for registering their own schemas.
registerSchedulerQueuePayloadSchema(
  'scheduler-test',
  z.object({ message: z.string().max(200).optional() }).passthrough(),
)
