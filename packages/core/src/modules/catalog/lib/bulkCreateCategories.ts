import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProductCategory } from '../data/entities'
import type { CategoryBulkCreateRow } from '../data/validators'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import {
  MAX_CHECKPOINTED_FAILURES,
  buildFirstRowIndexByKey,
  encodePriorKeyRows,
  findRecordCreatedByPreviousAttempt,
  readCheckpoint,
  readCheckpointInterval,
} from './bulkCreateCheckpoint'

export const CATALOG_CATEGORY_BULK_CREATE_QUEUE = 'catalog-category-bulk-create'

export { getCatalogQueue } from './catalogQueue'

export type CatalogCategoryBulkCreateFailureCode = 'slug_taken' | 'parent_not_found' | 'command_failed'

export type CatalogCategoryBulkCreateScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type CatalogCategoryBulkCreateJobPayload = {
  progressJobId: string
  items: CategoryBulkCreateRow[]
  scope: CatalogCategoryBulkCreateScope
}

export type CatalogCategoryBulkCreateFailure = {
  index: number
  name?: string
  code: CatalogCategoryBulkCreateFailureCode
  message: string
}

export type CatalogCategoryBulkCreateSummary = {
  createdCount: number
  failedCount: number
  /**
   * Not a complete list on a resumed run: it covers the rows the final attempt handled, while
   * `createdCount` covers the whole batch. Iterate it for the ids it does carry, never as a
   * substitute for `createdCount`.
   */
  createdIds: string[]
  failedItems: CatalogCategoryBulkCreateFailure[]
}

function buildCommandContext(
  scope: CatalogCategoryBulkCreateScope,
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

function normalizeSlugForLookup(slug?: string | null): string | null {
  if (typeof slug !== 'string') return null
  const trimmed = slug.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

function slugKey(slug: string): string {
  return `slug:${slug}`
}

/**
 * Every key the row's category could be found under — only its slug. `name` + `parentId` is
 * deliberately absent: `CatalogProductCategory` carries no uniqueness on `name`, so matching on it
 * would let one row claim an unrelated category and silently drop itself from the batch.
 */
function naturalKeysOfRow(row: CategoryBulkCreateRow): string[] {
  const slug = normalizeSlugForLookup(row.slug ?? null)
  return slug ? [slugKey(slug)] : []
}

/** The one key a row's record is reclaimed under on a resumed attempt. */
function naturalKeyOfRow(row: CategoryBulkCreateRow): string | null {
  return naturalKeysOfRow(row)[0] ?? null
}

export async function createCatalogCategoriesWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  items: CategoryBulkCreateRow[]
  scope: CatalogCategoryBulkCreateScope
}): Promise<CatalogCategoryBulkCreateSummary> {
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
  const priorCheckpoint = readCheckpoint<CatalogCategoryBulkCreateFailure>(existingJob?.meta)
  const checkpointInterval = readCheckpointInterval(existingJob?.meta)
  const startIndex = priorCheckpoint.lastCompletedRowIndex + 1

  await progressService.startJob(progressJobId, progressContext)

  // Batch pre-validation: fail rows referencing an already-taken slug or a missing parent before
  // ever calling the command, saving a DB round-trip for rows that are provably invalid up front.
  // The slug query also produces the key -> id map a resumed attempt uses to reclaim the records
  // an interrupted attempt already created, so resume costs no extra query.
  const distinctSlugs = Array.from(new Set(
    items
      .map((item) => normalizeSlugForLookup(item.slug ?? null))
      .filter((value): value is string => value !== null),
  ))
  const distinctParentIds = Array.from(new Set(
    items
      .map((item) => (item.parentId ? String(item.parentId) : null))
      .filter((value): value is string => value !== null),
  ))
  const existingKeyIds = new Map<string, string>()
  const existingSlugs = new Set<string>()
  if (distinctSlugs.length) {
    const rows = await em.find(CatalogProductCategory, {
      slug: { $in: distinctSlugs },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const category of rows) {
      const slug = category.slug as string
      existingSlugs.add(slug)
      existingKeyIds.set(slugKey(slug), category.id)
    }
  }
  const existingParentIds = distinctParentIds.length
    ? new Set(
      (await em.find(CatalogProductCategory, {
        id: { $in: distinctParentIds },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })).map((category) => category.id),
    )
    : new Set<string>()

  // Recorded once, on the attempt that starts from row 0, and read back verbatim by every later
  // attempt: after rows have been created the database can no longer tell which slugs predate the
  // job. This write rides the attempt's first `updateProgress`, which always persists (a fresh
  // throttle entry has no last-persisted timestamp to throttle against), so it is durable before
  // any row is created.
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
  // batch. Counting only from `startIndex` would silently drop every row completed before the
  // last durable checkpoint, reporting e.g. 40 created for a 100-row batch that fully succeeded.
  const createdIds: string[] = [...priorCheckpoint.createdIds]
  const failedItems: CatalogCategoryBulkCreateFailure[] = [...priorCheckpoint.failedItems]
  let createdCount = priorCheckpoint.createdCount
  let failedCount = priorCheckpoint.failedCount

  const recordFailure = (failure: CatalogCategoryBulkCreateFailure) => {
    failedItems.push(failure)
    failedCount += 1
  }

  const buildSummary = (): CatalogCategoryBulkCreateSummary => ({
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
    // Polled at the head of the iteration so a cancel is honored even when every remaining row
    // is rejected by pre-validation, and only on the checkpoint boundary: this is an
    // identity-map-bypassing read (`isCancellationRequested` uses `disableIdentityMap`), so a
    // per-row poll would add one uncached query per row on top of the command's own work.
    // Cancellation therefore lands within at most `checkpointInterval` rows.
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
    const slug = normalizeSlugForLookup(row.slug ?? null)

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

    if (slug && existingSlugs.has(slug)) {
      recordFailure({
        index,
        name: row.name,
        code: 'slug_taken',
        message: 'Category slug already exists for this organization.',
      })
      await checkpoint(index)
      continue
    }
    if (row.parentId && !existingParentIds.has(String(row.parentId))) {
      recordFailure({
        index,
        name: row.name,
        code: 'parent_not_found',
        message: 'Parent category not found or inaccessible.',
      })
      await checkpoint(index)
      continue
    }

    try {
      const { result } = await commandBus.execute<
        CategoryBulkCreateRow & { organizationId: string; tenantId: string },
        { categoryId: string }
      >('catalog.categories.create', {
        input: { ...row, organizationId: scope.organizationId, tenantId: scope.tenantId },
        ctx: commandContext,
      })
      if (result?.categoryId) {
        createdIds.push(result.categoryId)
        createdCount += 1
        if (slug) existingSlugs.add(slug)
      } else {
        // Recorded rather than dropped so `createdCount + failedCount` always accounts for
        // every row in the batch.
        recordFailure({
          index,
          name: row.name,
          code: 'command_failed',
          message: 'Category creation returned no category id.',
        })
      }
    } catch (error) {
      recordFailure({
        index,
        name: row.name,
        code: 'command_failed',
        message: error instanceof Error ? error.message : 'Category creation failed',
      })
    }

    await checkpoint(index)
  }

  const summary = buildSummary()
  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}
