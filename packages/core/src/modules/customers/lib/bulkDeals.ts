import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { runWithCacheTenant } from '@open-mercato/cache'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'

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

export type CustomersDealsBulkSummary = {
  affectedCount: number
  failedCount: number
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
  let affectedCount = 0
  let failedCount = 0

  for (const [index, id] of ids.entries()) {
    try {
      await commandBus.execute<{ body?: Record<string, unknown> }, { dealId: string }>(
        'customers.deals.update',
        {
          input: { body: buildBody(id) },
          ctx: commandContext,
          skipCacheInvalidation: true,
        },
      )
      affectedCount += 1
      updatedIds.add(id)
    } catch (error) {
      failedCount += 1
      console.warn(`[${logTag}] failed to update deal`, { id, error })
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

  const summary: CustomersDealsBulkSummary = { affectedCount, failedCount }
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
