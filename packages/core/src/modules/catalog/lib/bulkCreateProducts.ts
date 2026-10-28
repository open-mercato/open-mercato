import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '../data/entities'
import type { ProductBulkCreateRow } from '../data/validators'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import {
  MAX_CHECKPOINTED_FAILURES,
  buildFirstRowIndexByKey,
  encodePriorKeyRows,
  findRecordCreatedByPreviousAttempt,
  readCheckpoint,
  readCheckpointInterval,
} from './bulkCreateCheckpoint'

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
  /**
   * Not a complete list on a resumed run: it covers the rows the final attempt handled, while
   * `createdCount` covers the whole batch. Iterate it for the ids it does carry, never as a
   * substitute for `createdCount`.
   */
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

// Namespaced so a sku can never be confused with a handle that happens to spell the same string.
function skuKey(sku: string): string {
  return `sku:${sku}`
}

function handleKey(handle: string): string {
  return `handle:${handle}`
}

/**
 * Every key the row's product could be found under. `title` is deliberately absent: it carries no
 * uniqueness constraint, so matching on it would let one row claim an unrelated product and
 * silently drop itself from the batch.
 */
function naturalKeysOfRow(row: ProductBulkCreateRow): string[] {
  const keys: string[] = []
  const sku = normalizeForLookup(row.sku ?? null)
  if (sku) keys.push(skuKey(sku))
  const handle = normalizeForLookup(row.handle ?? null)
  if (handle) keys.push(handleKey(handle))
  return keys
}

/** The one key a row's record is reclaimed under on a resumed attempt; SKU wins when both exist. */
function naturalKeyOfRow(row: ProductBulkCreateRow): string | null {
  return naturalKeysOfRow(row)[0] ?? null
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

  // Batch pre-validation: fail rows referencing an already-taken sku or handle before ever
  // calling the command, saving a DB round-trip for rows that are provably invalid up front.
  // The same two queries also produce the key -> id map a resumed attempt uses to reclaim the
  // records an interrupted attempt already created, so resume costs no extra query.
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
  const existingKeyIds = new Map<string, string>()
  const existingSkus = new Set<string>()
  const existingHandles = new Set<string>()
  if (distinctSkus.length) {
    const rows = await em.find(CatalogProduct, {
      sku: { $in: distinctSkus },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const product of rows) {
      const sku = product.sku as string
      existingSkus.add(sku)
      existingKeyIds.set(skuKey(sku), product.id)
    }
  }
  if (distinctHandles.length) {
    const rows = await em.find(CatalogProduct, {
      handle: { $in: distinctHandles },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const product of rows) {
      const handle = product.handle as string
      existingHandles.add(handle)
      existingKeyIds.set(handleKey(handle), product.id)
    }
  }

  // Recorded once, on the attempt that starts from row 0, and read back verbatim by every later
  // attempt: after rows have been created the database can no longer tell which keys predate the
  // job. This write rides the attempt's first `updateProgress`, which always persists (a fresh
  // throttle entry has no last-persisted timestamp to throttle against), so it is durable before
  // any row is created. A row counts as pre-existing when *any* of its keys is already taken, so a
  // row whose handle is spoken for is never reclaimed on the strength of its free SKU.
  const isFirstAttempt = priorCheckpoint.priorKeyRows === null
  const priorKeyRowIndices: number[] = []
  if (isFirstAttempt) {
    items.forEach((item, index) => {
      if (naturalKeysOfRow(item).some((key) => existingKeyIds.has(key))) priorKeyRowIndices.push(index)
    })
  }
  await progressService.updateProgress(
    progressJobId,
    {
      totalCount: items.length,
      processedCount: startIndex,
      ...(isFirstAttempt ? { meta: { priorKeyRows: encodePriorKeyRows(priorKeyRowIndices, items.length) } } : {}),
    },
    progressContext,
  )

  const resumeIndex = {
    priorKeyRows: priorCheckpoint.priorKeyRows,
    existingKeyIds,
    firstRowIndexByKey: buildFirstRowIndexByKey(items, naturalKeysOfRow),
  }
  const reclaimedIds = new Set<string>()

  const commandContext = buildCommandContext(scope, container)
  // Seeded from the previous attempt's checkpoint so a resumed run's summary covers the whole
  // batch rather than only the rows after the last durable checkpoint (see
  // lib/bulkCreateCategories.ts for the failure this prevents).
  const createdIds: string[] = [...priorCheckpoint.createdIds]
  const failedItems: CatalogProductBulkCreateFailure[] = [...priorCheckpoint.failedItems]
  let createdCount = priorCheckpoint.createdCount
  let failedCount = priorCheckpoint.failedCount

  const recordFailure = (failure: CatalogProductBulkCreateFailure) => {
    failedItems.push(failure)
    failedCount += 1
  }

  const buildSummary = (): CatalogProductBulkCreateSummary => ({
    createdCount,
    failedCount,
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
            checkpointSummary: {
              createdCount,
              failedCount,
              failedItems: failedItems.slice(0, MAX_CHECKPOINTED_FAILURES),
            },
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

    // Reclaims a record an interrupted attempt of this job already created for this exact row,
    // so it is neither duplicated nor reported as a conflict against itself. Every other row
    // falls through to the normal path, including rows the classifier cannot speak for.
    const reclaimedId = findRecordCreatedByPreviousAttempt(resumeIndex, index, naturalKeyOfRow(row), reclaimedIds)
    if (reclaimedId) {
      reclaimedIds.add(reclaimedId)
      createdIds.push(reclaimedId)
      createdCount += 1
      await checkpoint(index)
      continue
    }

    if (sku && existingSkus.has(sku)) {
      recordFailure({
        index,
        title: row.title,
        code: 'sku_taken',
        message: 'Product SKU already exists for this organization.',
      })
      await checkpoint(index)
      continue
    }
    if (handle && existingHandles.has(handle)) {
      recordFailure({
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
      } else {
        // Recorded rather than dropped so `createdCount + failedCount` always accounts for
        // every row in the batch.
        recordFailure({
          index,
          title: row.title,
          code: 'command_failed',
          message: 'Product creation returned no product id.',
        })
      }
    } catch (error) {
      recordFailure({
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
