import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { SyncCursor } from '@open-mercato/core/modules/data_sync/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'

export const AKENEO_DELETE_IMPORTED_PRODUCTS_QUEUE = 'sync-akeneo-delete-products'

const PRODUCT_MAPPING_ENTITY_TYPES = [
  'catalog_product',
  'catalog_product_variant',
  'catalog_offer',
  'catalog_product_price',
  'attachment',
] as const

export type DeleteImportedProductsScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type DeleteImportedProductsJobPayload = {
  progressJobId: string
  scope: DeleteImportedProductsScope
}

export type DeleteImportedProductsSummary = {
  message: string
  requestedProductCount: number
  deletedProductCount: number
  skippedProductCount: number
}

function buildCommandContext(
  scope: DeleteImportedProductsScope,
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

function buildSummary(requestedProductCount: number, deletedProductCount: number): DeleteImportedProductsSummary {
  const skippedProductCount = Math.max(0, requestedProductCount - deletedProductCount)
  const baseMessage = deletedProductCount === 1
    ? 'Deleted 1 Akeneo-imported product.'
    : `Deleted ${deletedProductCount} Akeneo-imported products.`

  if (skippedProductCount <= 0) {
    return {
      message: baseMessage,
      requestedProductCount,
      deletedProductCount,
      skippedProductCount,
    }
  }

  return {
    message: `${baseMessage} Skipped ${skippedProductCount}.`,
    requestedProductCount,
    deletedProductCount,
    skippedProductCount,
  }
}

export async function findAkeneoImportedProductIds(
  em: EntityManager,
  scope: Pick<DeleteImportedProductsScope, 'organizationId' | 'tenantId'>,
): Promise<string[]> {
  const productMappings = await findWithDecryption(
    em,
    SyncExternalIdMapping,
    {
      integrationId: 'sync_akeneo',
      internalEntityType: 'catalog_product',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    {
      fields: ['internalEntityId', 'createdAt'],
      orderBy: { createdAt: 'asc' },
    },
    scope,
  )

  const metadataProducts = await findWithDecryption(
    em,
    CatalogProduct,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      metadata: {
        source: 'akeneo',
      },
    },
    {
      fields: ['id'],
      orderBy: { createdAt: 'asc' },
    },
    scope,
  )

  return Array.from(new Set(
    [
      ...(productMappings as Array<{ internalEntityId: string }>).map((entry) => entry.internalEntityId),
      ...(metadataProducts as Array<{ id: string }>).map((entry) => entry.id),
    ],
  ))
}

export async function deleteImportedProductsWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  scope: DeleteImportedProductsScope
}): Promise<DeleteImportedProductsSummary> {
  const { container, progressJobId, scope } = params
  const em = container.resolve('em') as EntityManager
  const commandBus = container.resolve('commandBus') as CommandBus
  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }

  await progressService.startJob(progressJobId, progressContext)

  const productIds = await findAkeneoImportedProductIds(em, scope)
  if (productIds.length > 0) {
    await progressService.updateProgress(
      progressJobId,
      { totalCount: productIds.length, processedCount: 0 },
      progressContext,
    )
  }

  if (productIds.length === 0) {
    const summary = buildSummary(0, 0)
    await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
    return summary
  }

  const commandContext = buildCommandContext(scope, container)
  let deletedProductCount = 0

  for (const [index, productId] of productIds.entries()) {
    try {
      await commandBus.execute<{ body?: Record<string, unknown> }, { productId: string }>('catalog.products.delete', {
        input: { body: { id: productId } },
        ctx: commandContext,
      })
      deletedProductCount += 1
    } catch {}

    await progressService.updateProgress(
      progressJobId,
      {
        totalCount: productIds.length,
        processedCount: index + 1,
      },
      progressContext,
    )
  }

  await em.nativeDelete(SyncExternalIdMapping, {
    integrationId: 'sync_akeneo',
    internalEntityType: { $in: [...PRODUCT_MAPPING_ENTITY_TYPES] },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  await em.nativeDelete(SyncCursor, {
    integrationId: 'sync_akeneo',
    entityType: 'products',
    direction: 'import',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  const summary = buildSummary(productIds.length, deletedProductCount)
  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)

  return summary
}
