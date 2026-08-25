import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '../data/entities'
import type { ProductBulkCreateRow } from '../data/validators'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import { readCheckpoint, readCheckpointInterval } from './bulkCreateCheckpoint'

export const CATALOG_PRODUCT_BULK_CREATE_QUEUE = 'catalog-product-bulk-create'

export { getCatalogQueue } from './catalogQueue'

export type CatalogProductBulkCreateFailureCode = 'sku_taken' | 'handle_taken' | 'command_failed'

export type CatalogProductBulkCreateScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type CatalogProductBulkCreateJobPayload = {
  progressJobId: string
  items: ProductBulkCreateRow[]
  scope: CatalogProductBulkCreateScope
}

export type CatalogProductBulkCreateFailure = {
  index: number
  title?: string
  code: CatalogProductBulkCreateFailureCode
  message: string
}

export type CatalogProductBulkCreateSummary = {
  createdCount: number
  failedCount: number
  createdIds: string[]
  failedItems: CatalogProductBulkCreateFailure[]
}

function buildCommandContext(
  scope: CatalogProductBulkCreateScope,
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

function normalizeForLookup(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export async function createCatalogProductsWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  items: ProductBulkCreateRow[]
  scope: CatalogProductBulkCreateScope
}): Promise<CatalogProductBulkCreateSummary> {
  const { container, progressJobId, items, scope } = params
  const commandBus = container.resolve('commandBus') as CommandBus
  const progressService = container.resolve('progressService') as ProgressService
  const em = container.resolve('em') as EntityManager
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }

  const existingJob = await progressService.getJob(progressJobId, progressContext)
  const priorCheckpoint = readCheckpoint<CatalogProductBulkCreateFailure>(existingJob?.meta)
  const checkpointInterval = readCheckpointInterval(existingJob?.meta)
  const startIndex = priorCheckpoint.lastCompletedRowIndex + 1

  await progressService.startJob(progressJobId, progressContext)
  await progressService.updateProgress(
    progressJobId,
    { totalCount: items.length, processedCount: startIndex },
    progressContext,
  )

  // Batch pre-validation only: fail rows referencing an already-taken sku or handle before
  // ever calling the command, saving a DB round-trip for rows that are provably invalid up
  // front.
  //
  // This does NOT attempt the spec's original "shared identity-map pre-warm" for
  // reference-data lookups (tax rate / unit defaults / option-schema template). Confirmed
  // while implementing Phase 1 (see lib/bulkCreateCategories.ts) that `catalog.products.create`
  // (commands/products.ts) resolves its own EntityManager via
  // `(ctx.container.resolve('em') as EntityManager).fork()` with no options, and MikroORM v7's
  // `ForkOptions.clear` defaults to `true` — every row's command call gets a fresh, empty
  // identity map. A follow-up attempt to work around this by `export`ing
  // `resolveScopedTaxRate`/`resolveProductUnitDefaults` and memoizing a worker-side copy was
  // also confirmed non-functional: `execute()`'s own call sites still invoke the original,
  // unwrapped module-local functions, so a wrapper built around the exported copy is never
  // consulted by the command. Making the reduction real would require editing `execute()`'s own
  // call sites in `commands/products.ts` — out of scope per the operator's decision to keep the
  // create commands entirely unchanged. This pre-fetch only earns its keep as the fail-fast
  // pre-validation used below.
  const distinctSkus = Array.from(new Set(
    items
      .map((item) => normalizeForLookup(item.sku ?? null))
      .filter((value): value is string => value !== null),
  ))
  const distinctHandles = Array.from(new Set(
    items
      .map((item) => normalizeForLookup(item.handle ?? null))
      .filter((value): value is string => value !== null),
  ))
  const existingSkus = distinctSkus.length
    ? new Set(
      (await em.find(CatalogProduct, {
        sku: { $in: distinctSkus },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })).map((product) => product.sku as string),
    )
    : new Set<string>()
  const existingHandles = distinctHandles.length
    ? new Set(
      (await em.find(CatalogProduct, {
        handle: { $in: distinctHandles },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })).map((product) => product.handle as string),
    )
    : new Set<string>()

  const commandContext = buildCommandContext(scope, container)
  // Seeded from the previous attempt's checkpoint so a resumed run's summary covers the whole
  // batch rather than only the rows after the last durable checkpoint (see
  // lib/bulkCreateCategories.ts for the failure this prevents).
  const createdIds: string[] = [...priorCheckpoint.createdIds]
  const failedItems: CatalogProductBulkCreateFailure[] = [...priorCheckpoint.failedItems]
  let createdCount = priorCheckpoint.createdCount

  // Same dynamic resume-boundary search as Phase 1 (see lib/bulkCreateCategories.ts) — the
  // durably-persisted `lastCompletedRowIndex` can lag behind the in-memory processing position,
  // so every row from `startIndex` is pre-checked against its natural key (sku, or handle, or
  // title) until the first row confirmed genuinely new.
  let resumeBoundaryReached = startIndex === 0

  const buildSummary = (): CatalogProductBulkCreateSummary => ({
    createdCount,
    failedCount: failedItems.length,
    createdIds,
    failedItems,
  })

  const checkpoint = async (index: number) => {
    const processedCount = index + 1
    if (processedCount % checkpointInterval === 0 || processedCount === items.length) {
      await progressService.updateProgress(
        progressJobId,
        {
          processedCount,
          meta: {
            lastCompletedRowIndex: index,
            checkpointSummary: { createdCount, createdIds, failedItems },
          },
        },
        progressContext,
      )
    }
  }

  for (let index = startIndex; index < items.length; index += 1) {
    // Polled at the head of the iteration and only on the checkpoint boundary — see
    // lib/bulkCreateCategories.ts for the reasoning.
    if ((index - startIndex) % checkpointInterval === 0) {
      const cancelled = await progressService.isCancellationRequested(
        progressJobId,
        scope.tenantId,
        scope.organizationId,
      )
      if (cancelled) {
        const partialSummary = buildSummary()
        await progressService.updateProgress(
          progressJobId,
          { meta: { resultSummary: partialSummary } },
          progressContext,
        )
        await progressService.markCancelled(progressJobId, progressContext)
        return partialSummary
      }
    }

    const row = items[index]
    const sku = normalizeForLookup(row.sku ?? null)
    const handle = normalizeForLookup(row.handle ?? null)

    if (!resumeBoundaryReached) {
      const alreadyCreated = sku
        ? await em.findOne(CatalogProduct, {
          sku,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
        : handle
          ? await em.findOne(CatalogProduct, {
            handle,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
          })
          : await em.findOne(CatalogProduct, {
            title: row.title,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
          })
      if (alreadyCreated) {
        createdIds.push(alreadyCreated.id)
        createdCount += 1
        if (sku) existingSkus.add(sku)
        if (handle) existingHandles.add(handle)
        await checkpoint(index)
        continue
      }
      resumeBoundaryReached = true
    }

    if (sku && existingSkus.has(sku)) {
      failedItems.push({
        index,
        title: row.title,
        code: 'sku_taken',
        message: 'Product SKU already exists for this organization.',
      })
      await checkpoint(index)
      continue
    }
    if (handle && existingHandles.has(handle)) {
      failedItems.push({
        index,
        title: row.title,
        code: 'handle_taken',
        message: 'Product handle already exists for this organization.',
      })
      await checkpoint(index)
      continue
    }

    try {
      const { result } = await commandBus.execute<
        ProductBulkCreateRow & { organizationId: string; tenantId: string },
        { productId: string }
      >('catalog.products.create', {
        input: { ...row, organizationId: scope.organizationId, tenantId: scope.tenantId },
        ctx: commandContext,
      })
      if (result?.productId) {
        createdIds.push(result.productId)
        createdCount += 1
        if (sku) existingSkus.add(sku)
        if (handle) existingHandles.add(handle)
      }
    } catch (error) {
      failedItems.push({
        index,
        title: row.title,
        code: 'command_failed',
        message: error instanceof Error ? error.message : 'Product creation failed',
      })
    }

    await checkpoint(index)
  }

  const summary = buildSummary()
  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}
