import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type {
  RegisteredSimulationEventAdapter,
  SimulationAuditEntry,
  SimulationAuditScanPage,
  SimulationAuditScanQuery,
  SimulationEventPayload,
  SimulationFeatureCheck,
  SimulationRecordHistoryPage,
  SimulationRecordHistoryQuery,
  SimulationScope,
  SimulationWindow,
} from '@open-mercato/shared/modules/insights/simulate'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { ActionLogFieldHistoryEntry } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { compareCodeUnits } from '../process/registry'

const logger = createLogger('insights').child({ component: 'simulation-context' })

export const SIMULATION_NIL_LOG_ID = '00000000-0000-0000-0000-000000000000'

type RbacFeatureChecker = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

type Resolver = { resolve: (name: string) => unknown }

export function resolveRbacFeatureChecker(container: Resolver): RbacFeatureChecker | null {
  try {
    const rbac = container.resolve('rbacService') as RbacFeatureChecker | undefined
    return rbac && typeof rbac.userHasAllFeatures === 'function' ? rbac : null
  } catch {
    return null
  }
}

/** The RBAC service failed (not a denial): callers answer 500 or let the queue retry the slice. */
export class SimulationFeatureCheckError extends Error {
  readonly reason: unknown

  constructor(reason: unknown) {
    super('[internal] The simulation feature check failed')
    this.name = 'SimulationFeatureCheckError'
    this.reason = reason
  }
}

/**
 * The requester's wildcard-aware feature check at one organization (`rbacService.userHasAllFeatures`),
 * memoized per feature list. Fails closed: without the RBAC service nothing is granted. A failing
 * RBAC service is not a denial: the error is reported and rethrown as `SimulationFeatureCheckError`
 * (never memoized), so a transient failure never cancels a run as forbidden.
 */
export function createFeatureCheck(container: Resolver, userId: string, scope: SimulationScope): SimulationFeatureCheck {
  const rbac = resolveRbacFeatureChecker(container)
  const cache = new Map<string, Promise<boolean>>()
  return async (features) => {
    const required = Array.from(new Set(features.filter((feature) => typeof feature === 'string' && feature.length > 0))).sort(compareCodeUnits)
    if (required.length === 0) return true
    if (!rbac) return false
    const key = required.join('\u0000')
    let pending = cache.get(key)
    if (!pending) {
      pending = rbac.userHasAllFeatures(userId, required, { tenantId: scope.tenantId, organizationId: scope.organizationId }).catch((error: unknown) => {
        cache.delete(key)
        logger.error('[internal] Simulation feature check failed', { err: error, tenantId: scope.tenantId, organizationId: scope.organizationId })
        getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_feature_check_failed' })
        throw new SimulationFeatureCheckError(error)
      })
      cache.set(key, pending)
    }
    return pending
  }
}

export function toSimulationAuditEntry(entry: ActionLogFieldHistoryEntry): SimulationAuditEntry {
  return {
    logId: entry.logId,
    at: entry.at,
    commandId: entry.commandId,
    actionType: entry.actionType,
    executionState: entry.executionState,
    actorUserId: entry.actorUserId,
    resourceKind: entry.resourceKind,
    resourceId: entry.resourceId,
    snapshotBefore: entry.snapshotBefore,
    snapshotAfter: entry.snapshotAfter,
    changes: entry.changes,
    causeKind: entry.causeKind,
    organizationId: entry.organizationId ?? null,
    correlationId: entry.correlationId ?? null,
    causedByLogId: entry.causedByLogId ?? null,
    actorKind: entry.actorKind,
  }
}

/**
 * Audit reads of a slice: decrypted, scoped to the run's organization, inside the run window
 * (`created_at` after `window.from`, up to `window.to`), `(created_at, id)` ascending. The service is
 * bound to the slice's read-only transaction, so its reads run under that transaction's statement
 * timeout.
 */
export function createAuditScanner(
  em: EntityManager,
  encryption: TenantDataEncryptionService | undefined,
  scope: SimulationScope,
  window: SimulationWindow,
  maxBytes: number,
): (query: SimulationAuditScanQuery) => Promise<SimulationAuditScanPage> {
  const service = new ActionLogService(em, encryption)
  const until = window.to.toISOString()
  const start = { createdAt: window.from.toISOString(), id: SIMULATION_NIL_LOG_ID }
  return async (query) => {
    const resourceKinds = Array.from(new Set(query.resourceKinds.filter((kind) => typeof kind === 'string' && kind.length > 0)))
    if (resourceKinds.length === 0) return { entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 }
    const page = await service.scanDecrypted({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      after: query.after ?? start,
      until,
      limit: query.limit,
      maxBytes,
      resourceKinds,
    })
    return {
      entries: page.entries.map(toSimulationAuditEntry),
      lastCursor: page.lastCursor,
      exhausted: page.exhausted,
      payloadBytes: page.payloadBytes,
      undecryptable: page.undecryptable,
    }
  }
}

/**
 * One record's own audit history for a slice (`readRecordHistory`): decrypted, scoped to the run's
 * organization, newest first, not bounded by the run window. Bound to the slice's read-only
 * transaction like the window scanner.
 */
export function createRecordHistoryReader(
  em: EntityManager,
  encryption: TenantDataEncryptionService | undefined,
  scope: SimulationScope,
): (query: SimulationRecordHistoryQuery) => Promise<SimulationRecordHistoryPage> {
  const service = new ActionLogService(em, encryption)
  return async (query) => {
    const resourceKinds = Array.from(new Set(query.resourceKinds.filter((kind) => typeof kind === 'string' && kind.length > 0)))
    const resourceId = typeof query.resourceId === 'string' ? query.resourceId.trim() : ''
    if (resourceKinds.length === 0 || resourceId.length === 0) return { entries: [], nextBefore: null }
    const page = await service.findFieldHistory({
      tenantId: scope.tenantId,
      organizationIds: [scope.organizationId],
      resourceKinds,
      resourceId,
      before: query.before,
      limit: query.limit,
    })
    return {
      entries: page.entries.map((entry) => ({ ...toSimulationAuditEntry(entry), historyAction: entry.historyAction ?? null })),
      nextBefore: page.nextBefore,
    }
  }
}

function splitPath(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((segment) => segment.length > 0)
}

function removePath(target: Record<string, unknown>, path: string): void {
  const segments = splitPath(path)
  if (segments.length === 0) return
  let node: unknown = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!node || typeof node !== 'object') return
    const segment = segments[index]
    if (!Object.prototype.hasOwnProperty.call(node, segment)) return
    node = (node as Record<string, unknown>)[segment]
  }
  if (node && typeof node === 'object') delete (node as Record<string, unknown>)[segments[segments.length - 1]]
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/**
 * Applies the past-values rule to a rebuilt payload: without `audit_logs.view_tenant` the paths an
 * adapter copied from audit snapshots are removed and become unknown (`cannot_tell`).
 */
export function applyPastValuePolicy(result: SimulationEventPayload, pastValuesAllowed: boolean): SimulationEventPayload {
  const valuePaths = (result.valuePaths ?? []).filter((path) => typeof path === 'string' && path.length > 0)
  if (pastValuesAllowed || valuePaths.length === 0) return result
  const payload = cloneJson(result.payload) ?? {}
  for (const path of valuePaths) removePath(payload, path)
  const unknownPaths = Array.from(new Set([...(result.unknownPaths ?? []), ...valuePaths]))
  return { payload, unknownPaths, valuePaths: [] }
}

/** The registered adapters with the requester's past-values rule applied to every rebuilt payload. */
export function withPastValuePolicy(
  adapters: readonly RegisteredSimulationEventAdapter[],
  pastValuesAllowed: boolean,
): RegisteredSimulationEventAdapter[] {
  return adapters.map((adapter) => ({
    ...adapter,
    payloadFrom(entry, ctx) {
      const rebuilt = adapter.payloadFrom(entry, ctx)
      return rebuilt ? applyPastValuePolicy(rebuilt, pastValuesAllowed) : null
    },
  }))
}
