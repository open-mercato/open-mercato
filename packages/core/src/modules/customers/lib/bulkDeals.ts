import type { AwilixContainer } from 'awilix'
import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { runWithCacheTenant } from '@open-mercato/cache'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
// Eagerly register the deal command handlers into this module graph's command
// registry. The bulk workers dispatch `customers.deals.update` through the command
// bus, but command handlers became lazy-loaded (#3703): they are only reachable if
// their generated loader was registered into the SAME `@open-mercato/shared` instance
// the worker's bus reads. A queue worker runs in its own container/process and must
// not depend on that external lazy registration having reached its instance — in the
// standalone integration harness the loader registry and the worker's bus can resolve
// to different `@open-mercato/shared` instances, leaving the lazy loader unreachable
// (issue: bulk deal jobs fail with "Command handler not registered for id
// customers.deals.update"). Importing the command module here registers the handlers
// through the worker's own import graph, so the dispatch always resolves.
import '../commands/deals'

export const CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE = 'customers-deals-bulk-update-stage'
export const CUSTOMERS_DEALS_BULK_UPDATE_OWNER_QUEUE = 'customers-deals-bulk-update-owner'

const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getCustomersQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing
  const concurrency = Math.max(
    1,
    Number.parseInt(process.env.CUSTOMERS_QUEUE_CONCURRENCY ?? '3', 10) || 3,
  )
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}

export type CustomersDealsBulkScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type CustomersDealsBulkUpdateStageJobPayload = {
  progressJobId: string
  ids: string[]
  pipelineStageId: string
  scope: CustomersDealsBulkScope
}

export type CustomersDealsBulkUpdateOwnerJobPayload = {
  progressJobId: string
  ids: string[]
  ownerUserId: string | null
  scope: CustomersDealsBulkScope
}

export type CustomersDealsBulkFailedItem = {
  id: string
  message: string
}

export type CustomersDealsBulkSummary = {
  affectedCount: number
  failedCount: number
  failedItems: CustomersDealsBulkFailedItem[]
}

export class BulkDealsPreflightError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BulkDealsPreflightError'
    this.code = code
  }
}

async function verifyPipelineStageExists(
  em: CoreEntityManager,
  stageId: string,
  scope: CustomersDealsBulkScope,
): Promise<void> {
  // The `pipelineStageId` posted from the kanban is a `customer_pipeline_stages.id`
  // (the per-pipeline stage definition that `commands/deals.ts:loadPipelineStageSnapshot`
  // also reads). It is NOT a `customer_dictionary_entries.id` — those entries are a
  // per-tenant dictionary used to centralize stage colours/icons by normalized label.
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `SELECT id FROM customer_pipeline_stages
       WHERE id = ?
         AND tenant_id = ?
         AND organization_id = ?
       LIMIT 1`,
    [stageId, scope.tenantId, scope.organizationId],
  )
  if (rows.length === 0) {
    throw new BulkDealsPreflightError(
      'pipeline_stage_not_found',
      `Pipeline stage ${stageId} does not exist in this tenant`,
    )
  }
}

const BULK_CACHE_ALIASES = ['customers.deals']

function buildCommandContext(
  scope: CustomersDealsBulkScope,
  container: AwilixContainer,
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function runBulkDealUpdate(params: {
  container: AwilixContainer
  progressJobId: string
  ids: string[]
  scope: CustomersDealsBulkScope
  cacheSource: string
  buildBody: (id: string) => Record<string, unknown>
  logTag: string
}): Promise<CustomersDealsBulkSummary> {
  const { container, progressJobId, ids, scope, cacheSource, buildBody, logTag } = params
  const commandBus = container.resolve('commandBus') as CommandBus
  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }

  await progressService.startJob(progressJobId, progressContext)
  await progressService.updateProgress(
    progressJobId,
    { totalCount: ids.length, processedCount: 0 },
    progressContext,
  )

  const commandContext = buildCommandContext(scope, container)
  const updatedIds = new Set<string>()
  const failedItems: CustomersDealsBulkFailedItem[] = []
  let affectedCount = 0

  for (const [index, id] of ids.entries()) {
    try {
      // `customers.deals.update` parses its input with `parseWithCustomFields(dealUpdateSchema, rawInput)`
      // and reads `parsed.id` at the top level (see commands/deals.ts). Wrapping the body in
      // `{ body: ... }` made `id` undefined and every per-deal call ZodError'd in the bulk
      // worker, so the job completed with affectedCount=0 in CI (TC-CRM-068/069).
      await commandBus.execute<Record<string, unknown>, { dealId: string }>(
        'customers.deals.update',
        {
          input: buildBody(id),
          ctx: commandContext,
          skipCacheInvalidation: true,
        },
      )
      affectedCount += 1
      updatedIds.add(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failedItems.push({ id, message })
      console.warn(`[${logTag}] failed to update deal`, { jobId: progressJobId, id, error })
    }

    await progressService.updateProgress(
      progressJobId,
      { totalCount: ids.length, processedCount: index + 1 },
      progressContext,
    )
  }

  await runWithCacheTenant(scope.tenantId, async () => {
    for (const id of updatedIds) {
      await invalidateCrudCache(
        container,
        'customers.deal',
        { id, organizationId: scope.organizationId, tenantId: scope.tenantId },
        scope.tenantId,
        cacheSource,
        BULK_CACHE_ALIASES,
      )
    }
  })

  const summary: CustomersDealsBulkSummary = {
    affectedCount,
    failedCount: failedItems.length,
    failedItems,
  }
  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}

export async function bulkUpdateDealStageWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  ids: string[]
  pipelineStageId: string
  scope: CustomersDealsBulkScope
}): Promise<CustomersDealsBulkSummary> {
  // Pre-flight check: verify the target stage exists in the caller's tenant scope before
  // doing N per-deal command calls. An invalid stage would otherwise produce N identical
  // failures in `runBulkDealUpdate` and a noisy `failedItems` list.
  const em = params.container.resolve('em') as CoreEntityManager
  await verifyPipelineStageExists(em, params.pipelineStageId, params.scope)
  return runBulkDealUpdate({
    container: params.container,
    progressJobId: params.progressJobId,
    ids: params.ids,
    scope: params.scope,
    cacheSource: 'bulk-update-stage:customers.deals',
    logTag: 'customers.deals.bulk-update-stage',
    buildBody: (id) => ({ id, pipelineStageId: params.pipelineStageId }),
  })
}

export async function bulkUpdateDealOwnerWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  ids: string[]
  ownerUserId: string | null
  scope: CustomersDealsBulkScope
}): Promise<CustomersDealsBulkSummary> {
  return runBulkDealUpdate({
    container: params.container,
    progressJobId: params.progressJobId,
    ids: params.ids,
    scope: params.scope,
    cacheSource: 'bulk-update-owner:customers.deals',
    logTag: 'customers.deals.bulk-update-owner',
    buildBody: (id) => ({ id, ownerUserId: params.ownerUserId }),
  })
}
