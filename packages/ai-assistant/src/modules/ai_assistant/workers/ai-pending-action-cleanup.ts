import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { AiPendingActionRepository } from '../data/repositories/AiPendingActionRepository'
import type { AiPendingAction } from '../data/entities'
import {
  emitAiAssistantEvent,
  type AiActionExpiredPayload,
  type AiAssistantEventId,
} from '../events'
import { AiPendingActionStateError } from '../lib/pending-action-types'

/**
 * Periodic cleanup worker for the Phase 3 WS-C mutation approval gate
 * (Step 5.12).
 *
 * Responsibilities:
 * - Sweep every tenant for rows where `status = 'pending'` AND
 *   `expires_at < now`. Pending actions expire after
 *   `AI_PENDING_ACTION_TTL_SECONDS` (default 15 minutes) — confirm/cancel
 *   routes flip them opportunistically, but rows nobody touches again
 *   would otherwise sit in `pending` forever.
 * - Atomically transition each expired row `pending → expired` via the
 *   repository's state-machine guard. `resolvedByUserId` is `null`
 *   because the worker (not a user) is the actor; `resolvedAt` is `now`.
 * - Emit the typed `ai.action.expired` event via
 *   {@link emitAiAssistantEvent} for each successful transition so
 *   downstream subscribers (UI, audit, metrics) see a single canonical
 *   terminal signal.
 *
 * Race safety:
 * - `AiPendingActionRepository.setStatus` enforces the state machine
 *   from `pending-action-types.ts`; the legal exits for `pending` are
 *   `confirmed`, `cancelled`, `expired`. If a concurrent confirm raced
 *   us and flipped the row to `confirmed` (or `executing`), the repo
 *   throws {@link AiPendingActionStateError} — we catch, log, and skip,
 *   WITHOUT emitting an event for that row (the confirm path already
 *   emitted the canonical signal). Same behaviour if the cancel helper
 *   beat us via its TTL short-circuit.
 * - Single-row failures NEVER abort the batch — the worker logs and
 *   continues to the next row.
 * - Running the worker twice on an already-`expired` row is a no-op:
 *   `setStatus(expired)` short-circuits on `existing.status === nextStatus`
 *   (see repo), so no second emit.
 *
 * Tenant scoping:
 * - `listExpired` is tenant-scoped, so the worker first discovers the
 *   distinct set of `tenant_id` values that have expired pending rows
 *   via a narrow native SELECT (no row contents read). It then iterates
 *   per tenant, reusing the repo and therefore the encrypted-read
 *   contract. Each `setStatus` write carries the row's own tenant
 *   scope — there is no cross-tenant write.
 *
 * Pagination:
 * - `listExpired` is called with a bounded page size and looped until
 *   the tenant's expired queue drains. A per-tenant loop cap prevents
 *   runaway behaviour if new rows keep expiring during the sweep (the
 *   next scheduled tick picks up any leftovers).
 */

export const metadata: WorkerMeta = {
  queue: 'ai-pending-action-cleanup',
  id: 'ai_assistant:cleanup-expired-pending-actions',
  concurrency: 1,
}

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGES_PER_TENANT = 50

export type PendingActionCleanupEmitter = (
  eventId: Extract<AiAssistantEventId, 'ai.action.expired'>,
  payload: AiActionExpiredPayload,
) => Promise<void>

const defaultEmitter: PendingActionCleanupEmitter = async (eventId, payload) => {
  await emitAiAssistantEvent(eventId, payload as unknown as Record<string, unknown>, {
    persistent: true,
  })
}

export interface PendingActionCleanupRunOptions {
  em: EntityManager
  repo?: AiPendingActionRepository
  emitEvent?: PendingActionCleanupEmitter
  now?: Date
  pageSize?: number
  /** Injectable tenant-discovery seam for unit tests. */
  discoverTenants?: (em: EntityManager, now: Date) => Promise<TenantScope[]>
}

export interface PendingActionCleanupSummary {
  tenantsScanned: number
  rowsProcessed: number
  rowsExpired: number
  rowsSkipped: number
  rowsErrored: number
}

export interface TenantScope {
  tenantId: string
  organizationId: string | null
}

async function discoverTenantsDefault(
  em: EntityManager,
  now: Date,
): Promise<TenantScope[]> {
  const connection = em.getConnection()
  const rows = await connection.execute(
    `select distinct "tenant_id", "organization_id"
       from "ai_pending_actions"
      where "status" = 'pending'
        and "expires_at" < ?`,
    [now],
    'all',
  )
  if (!Array.isArray(rows)) return []
  const out: TenantScope[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null
    if (!tenantId) continue
    const organizationId =
      typeof row.organization_id === 'string' ? row.organization_id : null
    out.push({ tenantId, organizationId })
  }
  return out
}

function toIso(value: Date | string | null | undefined, fallback: Date): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback.toISOString()
}

function buildExpiredPayload(
  row: AiPendingAction,
  scope: TenantScope,
  clock: Date,
): AiActionExpiredPayload {
  const resolvedAtIso = toIso(row.resolvedAt ?? clock, clock)
  const expiresAtIso = toIso(row.expiresAt ?? clock, clock)
  return {
    pendingActionId: row.id,
    agentId: row.agentId,
    toolName: row.toolName,
    status: row.status,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? null,
    userId: row.createdByUserId ?? null,
    resolvedByUserId: null,
    resolvedAt: resolvedAtIso,
    expiresAt: expiresAtIso,
    expiredAt: resolvedAtIso,
  }
}

export async function runPendingActionCleanup(
  options: PendingActionCleanupRunOptions,
): Promise<PendingActionCleanupSummary> {
  const clock = options.now ?? new Date()
  const repo = options.repo ?? new AiPendingActionRepository(options.em)
  const emitter = options.emitEvent ?? defaultEmitter
  const pageSize = Math.max(1, Math.min(500, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const discoverTenants = options.discoverTenants ?? discoverTenantsDefault

  const summary: PendingActionCleanupSummary = {
    tenantsScanned: 0,
    rowsProcessed: 0,
    rowsExpired: 0,
    rowsSkipped: 0,
    rowsErrored: 0,
  }

  let tenants: TenantScope[] = []
  try {
    tenants = await discoverTenants(options.em, clock)
  } catch (error) {
    console.error(
      '[ai-pending-action-cleanup] Failed to discover tenants:',
      error,
    )
    return summary
  }

  if (!tenants.length) return summary

  for (const scope of tenants) {
    summary.tenantsScanned += 1
    for (let page = 0; page < MAX_PAGES_PER_TENANT; page += 1) {
      let expiredRows: AiPendingAction[]
      try {
        expiredRows = await repo.listExpired(
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: null,
          },
          clock,
          pageSize,
        )
      } catch (error) {
        console.error(
          `[ai-pending-action-cleanup] listExpired failed for tenant ${scope.tenantId}:`,
          error,
        )
        break
      }

      if (!expiredRows.length) break

      for (const row of expiredRows) {
        summary.rowsProcessed += 1
        try {
          const updated = await repo.setStatus(
            row.id,
            'expired',
            {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              userId: null,
            },
            { resolvedByUserId: null, now: clock },
          )
          summary.rowsExpired += 1
          const payload = buildExpiredPayload(updated, scope, clock)
          try {
            await emitter('ai.action.expired', payload)
          } catch (emitError) {
            console.warn(
              `[ai-pending-action-cleanup] Failed to emit ai.action.expired for ${row.id}:`,
              emitError,
            )
          }
        } catch (error) {
          if (error instanceof AiPendingActionStateError) {
            summary.rowsSkipped += 1
            console.info(
              `[ai-pending-action-cleanup] Skipping ${row.id}: concurrent transition ${error.from} → ${error.to} already occurred`,
            )
            continue
          }
          summary.rowsErrored += 1
          console.error(
            `[ai-pending-action-cleanup] Failed to expire ${row.id}:`,
            error,
          )
        }
      }

      if (expiredRows.length < pageSize) break
    }
  }

  return summary
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  _job: QueuedJob,
  ctx: HandlerContext,
): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  await runPendingActionCleanup({ em })
}
