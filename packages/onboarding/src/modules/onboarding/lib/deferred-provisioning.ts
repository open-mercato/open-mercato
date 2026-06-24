import type { EntityManager } from '@mikro-orm/postgresql'
import type { SearchIndexer } from '@open-mercato/search'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import type { OnboardingRequest } from '@open-mercato/onboarding/modules/onboarding/data/entities'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendWorkspaceReadyEmail } from '@open-mercato/onboarding/modules/onboarding/lib/ready-email'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { PREPARATION_CLAIM_STALE_MS } from '@open-mercato/onboarding/modules/onboarding/lib/preparation-claim'

const VECTOR_REINDEX_ENQUEUE_TIMEOUT_MS = 5_000
const SEED_EXAMPLES_TIMEOUT_MS = 15_000
// Steady lease-renewal cadence while the chain works. Must stay well below
// PREPARATION_CLAIM_STALE_MS so a live runner is never mistaken for a crashed
// one, regardless of how long any single module's seedExamples takes.
const PREPARATION_HEARTBEAT_MS = 5_000

export function resolveProvisioningIds(request: OnboardingRequest) {
  if (!request.tenantId || !request.organizationId || !request.userId) return null
  return {
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    userId: request.userId,
  }
}

function createTimeoutPromise(label: string, timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
}

async function runModuleSetupHook(args: {
  moduleId: string
  phase: 'seedExamples'
  timeoutMs: number
  run: () => Promise<void>
}) {
  const startedAt = Date.now()
  console.info('[onboarding.verify] module hook started', {
    moduleId: args.moduleId,
    phase: args.phase,
    timeoutMs: args.timeoutMs,
  })
  try {
    await Promise.race([
      args.run(),
      createTimeoutPromise(`module ${args.moduleId} ${args.phase}`, args.timeoutMs),
    ])
    console.info('[onboarding.verify] module hook completed', {
      moduleId: args.moduleId,
      phase: args.phase,
      durationMs: Math.max(0, Date.now() - startedAt),
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Deferred provisioning is re-triggered on every preparing-page status
      // poll until preparationCompletedAt is set. seedExamples is not fully
      // idempotent (e.g. catalog product handles are unique-scoped), so a
      // re-run that lands before completion collides on an already-seeded row.
      // The workspace is already provisioned and the collision is expected and
      // harmless — log at info so genuine failures still stand out.
      console.info('[onboarding.verify] module hook skipped (already seeded)', {
        moduleId: args.moduleId,
        phase: args.phase,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
    } else {
      console.error('[onboarding.verify] module hook failed', {
        moduleId: args.moduleId,
        phase: args.phase,
        durationMs: Math.max(0, Date.now() - startedAt),
        timeoutMs: args.timeoutMs,
        error,
      })
    }
    throw error
  }
}

async function markWorkspaceReady(args: {
  requestId: string
  service: OnboardingService
}) {
  const request = await args.service.findById(args.requestId)
  // The status guard protects a request that was re-submitted (and reset to
  // pending) while this chain was still running — completing it would let the
  // new flow skip its own deferred provisioning.
  if (!request || request.preparationCompletedAt || request.status !== 'completed') return
  await args.service.markPreparationCompleted(request, new Date())
}

async function enqueueVectorReindex(args: {
  container: { resolve: <T = unknown>(name: string) => T }
  tenantId: string
  organizationId: string
}) {
  let searchIndexer: SearchIndexer | null = null
  try {
    searchIndexer = args.container.resolve<SearchIndexer>('searchIndexer')
  } catch {
    searchIndexer = null
  }
  if (!searchIndexer) return

  await Promise.race([
    searchIndexer.reindexAllToVector({
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      purgeFirst: true,
      useQueue: true,
    }),
    createTimeoutPromise('vector reindex enqueue', VECTOR_REINDEX_ENQUEUE_TIMEOUT_MS),
  ])
}

type PersistentEventBus = {
  emitEvent: (
    event: string,
    payload: unknown,
    options?: { persistent?: boolean; deliverInline?: boolean },
  ) => Promise<void>
}

async function enqueueQueryIndexRebuild(args: {
  container: { resolve: <T = unknown>(name: string) => T }
  tenantId: string
}) {
  // Hand the heavy query-index rebuild to the durable queue instead of running
  // a multi-minute force purge+reindex of every system entity inline — that
  // inline rebuild was what stalled the preparing page and exhausted the PG
  // pool. Each entity becomes a persistent `query_index.reindex` job, so it
  // survives a worker/process restart and is retried independently of
  // onboarding. reindexEntity({ force: true }) purges the scope and refreshes
  // coverage internally, so no explicit purge/coverage sweep is needed here.
  //
  // Scope is the whole tenant (no organizationId): the previous inline rebuild
  // reindexed tenant-wide, which also covers organization_id IS NULL rows and
  // entities whose org is derived from the row (e.g. directory:organization).
  // Narrowing to a single org would silently drop those.
  let eventBus: PersistentEventBus | null = null
  try {
    eventBus = args.container.resolve<PersistentEventBus>('eventBus')
  } catch {
    eventBus = null
  }
  if (!eventBus) return

  const entityIds = flattenSystemEntityIds(getEntityIds())
  for (const entityType of entityIds) {
    try {
      // deliverInline: false is load-bearing here. A bare `{ persistent: true }`
      // emit dual-dispatches: the events worker drains the queued job AND the
      // subscriber runs inline in THIS request — so the multi-minute force
      // reindex of every system entity would still block onboarding (and reuse
      // the request's already-committed em, spamming "Transaction is already
      // committed" from the vector-purge status-log prune). Enqueue-only hands
      // the rebuild to the worker and returns immediately.
      await eventBus.emitEvent(
        'query_index.reindex',
        {
          entityType,
          tenantId: args.tenantId,
          force: true,
        },
        { persistent: true, deliverInline: false },
      )
    } catch (error) {
      console.error('[onboarding.verify] failed to enqueue query index rebuild', {
        entityType,
        tenantId: args.tenantId,
        error,
      })
    }
  }
}

export async function runDeferredProvisioning(args: {
  requestId: string
  tenantId: string
  organizationId: string
}) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)

  // Single-flight guard: the preparing page polls the status endpoint every
  // second and each poll (plus the verify handler) schedules this chain. The
  // atomic claim collapses those triggers into one run per request — without
  // it, dozens of concurrent seed + full-reindex chains exhaust the PG
  // connection pool (2026-06-11 demo outage). A stale claim (crashed runner)
  // becomes reclaimable after PREPARATION_CLAIM_STALE_MS.
  const claimedAt = new Date()
  const claimed = await service.claimPreparation(
    args.requestId,
    claimedAt,
    new Date(claimedAt.getTime() - PREPARATION_CLAIM_STALE_MS),
  )
  if (!claimed) {
    console.info('[onboarding.verify] deferred provisioning skipped (already claimed or completed)', {
      requestId: args.requestId,
      tenantId: args.tenantId,
    })
    return
  }

  // Steady heartbeat on a SEPARATE EntityManager (own connection) so renewal can
  // never interleave with the chain's own DB work on `em`. This keeps the lease
  // fresh on a fixed cadence independent of how long any single module's
  // seedExamples takes, which is what lets PREPARATION_CLAIM_STALE_MS stay short:
  // a runner that actually crashes stops renewing and is reclaimable in seconds,
  // while a genuinely-working one is never falsely reclaimed. renewPreparation is
  // a no-op once the request is completed, so a late tick can't resurrect a
  // finished lease.
  const heartbeatEm = typeof (em as { fork?: () => EntityManager }).fork === 'function'
    ? em.fork()
    : em
  const heartbeatService = new OnboardingService(heartbeatEm)
  const heartbeat = setInterval(() => {
    void heartbeatService.renewPreparation(args.requestId, new Date()).catch(() => {})
  }, PREPARATION_HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  try {
    const modules = getModules()

    for (const mod of modules) {
      if (!mod.setup?.seedExamples) continue
      // Renew immediately before each module too, so even a long-running module
      // starts from a fresh lease in addition to the steady heartbeat above.
      await service.renewPreparation(args.requestId, new Date()).catch(() => {})
      try {
        await runModuleSetupHook({
          moduleId: mod.id,
          phase: 'seedExamples',
          timeoutMs: SEED_EXAMPLES_TIMEOUT_MS,
          run: () => mod.setup!.seedExamples!({
            em,
            tenantId: args.tenantId,
            organizationId: args.organizationId,
            container,
          }),
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          console.info('[onboarding.verify] deferred seedExamples skipped (already applied)', {
            moduleId: mod.id,
            tenantId: args.tenantId,
            organizationId: args.organizationId,
          })
        } else {
          console.error('[onboarding.verify] deferred seedExamples failed', {
            moduleId: mod.id,
            tenantId: args.tenantId,
            organizationId: args.organizationId,
            error,
          })
        }
      }
    }

    // The query-index rebuild is ENQUEUED before the completion flag, not run
    // inline: preparationCompletedAt is the terminal gate for both the
    // status-route scheduling and claimPreparation, so a runner that dies before
    // the jobs are queued must leave the flag unset — the stale claim then makes
    // the chain reclaimable and re-enqueues (a repeated force reindex is
    // harmless). Enqueuing is fast, so the workspace is marked ready in seconds
    // while the actual reindex runs in the background workers.
    await enqueueQueryIndexRebuild({
      container,
      tenantId: args.tenantId,
    })

    await markWorkspaceReady({
      requestId: args.requestId,
      service,
    })
  } finally {
    // Stop renewing as soon as the chain finishes (or throws): a crashed runner
    // must let the lease go stale so a status poll can reclaim it.
    clearInterval(heartbeat)
  }

  // Non-fatal (#2954 contract): an email failure must not abort the chain.
  // The status endpoint retries the ready email on later polls while
  // readyEmailSentAt is unset.
  await sendWorkspaceReadyEmail({
    requestId: args.requestId,
    tenantId: args.tenantId,
  }).catch((error) => {
    console.error('[onboarding.verify] ready email failed', {
      requestId: args.requestId,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      error,
    })
  })

  await enqueueVectorReindex({
    container,
    tenantId: args.tenantId,
    organizationId: args.organizationId,
  }).catch((error) => {
    console.warn('[onboarding.verify] vector reindex enqueue did not complete promptly', {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      reason: error instanceof Error ? error.message : String(error),
    })
  })
}
