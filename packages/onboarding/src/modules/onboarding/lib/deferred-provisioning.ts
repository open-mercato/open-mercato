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
import { PREPARATION_CLAIM_STALE_MS } from '@open-mercato/onboarding/modules/onboarding/lib/preparation-claim'

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

  const modules = getModules()

  for (const mod of modules) {
    if (!mod.setup?.seedExamples) continue
    // Heartbeat: keep the lease fresh while legitimately working so a slow run
    // (many modules × 15s seed timeout + rebuild) can never look stale and get
    // double-claimed by a later poll.
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

  // The rebuild runs BEFORE the completion flag: preparationCompletedAt is the
  // terminal gate for both the status-route scheduling and claimPreparation,
  // so a runner that dies mid-rebuild must leave the flag unset — the stale
  // claim then makes the whole chain reclaimable and the rebuild self-heals.
  // rebuildTenantQueryIndexes never throws (it logs per-entity failures).
  await service.renewPreparation(args.requestId, new Date()).catch(() => {})
  await rebuildTenantQueryIndexes({
    em,
    tenantId: args.tenantId,
    organizationId: args.organizationId,
  })

  await markWorkspaceReady({
    requestId: args.requestId,
    service,
  })

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
