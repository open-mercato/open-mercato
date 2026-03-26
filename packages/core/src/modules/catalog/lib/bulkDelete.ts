import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { createQueue, type Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'

export const CATALOG_PRODUCT_BULK_DELETE_QUEUE = 'catalog-product-bulk-delete'

const queues = new Map<string, Queue<Record<string, unknown>>>()

export type CatalogProductBulkDeleteScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type CatalogProductBulkDeleteJobPayload = {
  progressJobId: string
  ids: string[]
  scope: CatalogProductBulkDeleteScope
}

export type CatalogProductBulkDeleteSummary = {
  affectedCount: number
}

const BULK_DELETE_CACHE_ALIASES = ['catalog.products']

export function getCatalogQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const created = process.env.QUEUE_STRATEGY === 'async'
    ? createQueue<Record<string, unknown>>(queueName, 'async', {
      connection: { url: getRedisUrl('QUEUE') },
      concurrency: Math.max(1, Number.parseInt(process.env.CATALOG_QUEUE_CONCURRENCY ?? '3', 10) || 3),
    })
    : createQueue<Record<string, unknown>>(queueName, 'local')

  queues.set(queueName, created)
  return created
}

function buildCommandContext(
  scope: CatalogProductBulkDeleteScope,
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

export async function deleteCatalogProductsWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  ids: string[]
  scope: CatalogProductBulkDeleteScope
}): Promise<CatalogProductBulkDeleteSummary> {
  const { container, progressJobId, ids, scope } = params
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
  let affectedCount = 0
  const deletedIds = new Set<string>()

  for (const [index, id] of ids.entries()) {
    await commandBus.execute<{ body?: Record<string, unknown> }, { productId: string }>('catalog.products.delete', {
      input: { body: { id } },
      ctx: commandContext,
      skipCacheInvalidation: true,
    })
    affectedCount += 1
    deletedIds.add(id)

    await progressService.updateProgress(
      progressJobId,
      {
        totalCount: ids.length,
        processedCount: index + 1,
      },
      progressContext,
    )
  }

  const summary: CatalogProductBulkDeleteSummary = { affectedCount }
  for (const id of deletedIds) {
    await invalidateCrudCache(
      container,
      'catalog.product',
      {
        id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      scope.tenantId,
      'bulk-delete:catalog.products',
      BULK_DELETE_CACHE_ALIASES,
    )
  }
  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)

  return summary
}
