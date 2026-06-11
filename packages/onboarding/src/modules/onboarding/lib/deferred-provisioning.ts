import type { EntityManager } from '@mikro-orm/postgresql'
import type { SearchIndexer } from '@open-mercato/search'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import type { OnboardingRequest } from '@open-mercato/onboarding/modules/onboarding/data/entities'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendWorkspaceReadyEmail } from '@open-mercato/onboarding/modules/onboarding/lib/ready-email'
import { reindexEntity } from '@open-mercato/core/modules/query_index/lib/reindexer'
import { purgeIndexScope } from '@open-mercato/core/modules/query_index/lib/purge'
import { refreshCoverageSnapshot } from '@open-mercato/core/modules/query_index/lib/coverage'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'

const VECTOR_REINDEX_ENQUEUE_TIMEOUT_MS = 5_000
const SEED_EXAMPLES_TIMEOUT_MS = 15_000

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
}) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findById(args.requestId)
  if (!request || request.preparationCompletedAt) return
  await service.markPreparationCompleted(request, new Date())
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

async function rebuildTenantQueryIndexes(args: {
  em: EntityManager
  tenantId: string
  organizationId: string
}) {
  const coverageRefreshKeys = new Set<string>()
  try {
    const allEntities = getEntityIds()
    const entityIds = flattenSystemEntityIds(allEntities)
    for (const entityType of entityIds) {
      try {
        await purgeIndexScope(args.em, { entityType, tenantId: args.tenantId })
      } catch (error) {
        console.error('[onboarding.verify] failed to purge query index scope', {
          entityType,
          tenantId: args.tenantId,
          error,
        })
      }
      try {
        await reindexEntity(args.em, {
          entityType,
          tenantId: args.tenantId,
          force: true,
          emitVectorizeEvents: false,
          vectorService: null,
        })
      } catch (error) {
        console.error('[onboarding.verify] failed to reindex entity', {
          entityType,
          tenantId: args.tenantId,
          error,
        })
      }
      coverageRefreshKeys.add(`${entityType}|${args.tenantId}|__null__`)
      coverageRefreshKeys.add(`${entityType}|${args.tenantId}|${args.organizationId}`)
    }
  } catch (error) {
    console.error('[onboarding.verify] failed to rebuild query indexes', { tenantId: args.tenantId, error })
  }

  if (!coverageRefreshKeys.size) return

  for (const entry of coverageRefreshKeys) {
    const [entityType, tenantKey, orgKey] = entry.split('|')
    const orgScope = orgKey === '__null__' ? null : orgKey
    try {
      await refreshCoverageSnapshot(
        args.em,
        {
          entityType,
          tenantId: tenantKey,
          organizationId: orgScope,
          withDeleted: false,
        },
      )
    } catch (error) {
      console.error('[onboarding.verify] failed to refresh coverage snapshot', {
        entityType,
        tenantId: tenantKey,
        organizationId: orgScope,
        error,
      })
    }
  }
}

// A crashed pass leaves its claim set; reclaim it after this window so a later
// poll can finish the workspace. Must exceed a healthy pass's wall-clock
// (seedExamples + full tenant reindex) so a slow-but-live run is never stolen.
const PREPARATION_CLAIM_STALE_MS = 5 * 60 * 1000

export async function runDeferredProvisioning(args: {
  requestId: string
  tenantId: string
  organizationId: string
}) {
  // The preparing page re-triggers this on every status poll until
  // preparationCompletedAt is set. Each pass is long (per-module seedExamples
  // plus a full tenant reindex) and holds DB connections, so overlapping passes
  // for the same request saturate the pool — and under saturation the
  // completion write itself times out, so the flag is never set and the polls
  // keep re-spawning the storm. Single-flight the pass with an atomic DB claim
  // (cross-process, unlike an in-memory guard): only the poll that wins the
  // claim runs; the rest return immediately. The claim is released in finally,
  // and a crashed pass is reclaimed after PREPARATION_CLAIM_STALE_MS, so an
  // interrupted run always stays recoverable.
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findById(args.requestId)
  if (!request || request.preparationCompletedAt) return

  const claimedAt = new Date()
  const staleBefore = new Date(claimedAt.getTime() - PREPARATION_CLAIM_STALE_MS)
  const claimed = await service.claimPreparation(request, claimedAt, staleBefore)
  if (!claimed) return

  try {
    await executeDeferredProvisioning({ container, em, ...args })
  } finally {
    await service.releasePreparation(request, claimedAt).catch((error) => {
      console.error('[onboarding.verify] failed to release preparation claim', {
        requestId: args.requestId,
        error,
      })
    })
  }
}

async function executeDeferredProvisioning(args: {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
  requestId: string
  tenantId: string
  organizationId: string
}) {
  const { container, em } = args
  const modules = getModules()

  for (const mod of modules) {
    if (!mod.setup?.seedExamples) continue
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

  // Build the query indexes BEFORE marking preparation complete. The completion
  // flag is the recovery boundary: status polls stop re-triggering this pass
  // once it is set, so it must not be written until the durable index rebuild
  // has finished. A pass that crashes mid-rebuild therefore leaves the flag
  // unset and stays reclaimable, instead of stranding a workspace whose search
  // indexes were never built.
  await rebuildTenantQueryIndexes({
    em,
    tenantId: args.tenantId,
    organizationId: args.organizationId,
  })

  await markWorkspaceReady({
    requestId: args.requestId,
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

  // Sent last: the workspace is already complete and recoverable, so a failed
  // ready-email must not roll the pass back. status.ts retries the email
  // separately while readyEmailSentAt is unset.
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
    throw error
  })
}
