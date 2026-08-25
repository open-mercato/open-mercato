import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProductCategory } from '../data/entities'
import type { CategoryBulkCreateRow } from '../data/validators'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import { readCheckpoint, readCheckpointInterval } from './bulkCreateCheckpoint'

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
  await progressService.updateProgress(
    progressJobId,
    { totalCount: items.length, processedCount: startIndex },
    progressContext,
  )

  // Batch pre-validation: fail rows referencing an already-taken slug or a missing
  // parent before ever calling the command, saving a DB round-trip for rows that
  // are provably invalid up front.
  //
  // This does NOT double as the spec's "shared identity-map pre-warm" optimization:
  // `catalog.categories.create` (commands/categories.ts) resolves its own
  // EntityManager via `(ctx.container.resolve('em') as EntityManager).fork()` with
  // no options, and MikroORM v7's `ForkOptions.clear` defaults to `true` — every
  // row's command call therefore gets a fresh, empty identity map regardless of
  // what this worker pre-fetches here, and this repo configures no MikroORM result
  // cache (packages/shared/src/lib/db/mikro.ts) that could serve a hit some other
  // way. The command is intentionally left unchanged (spec Resolved Assumption #3),
  // so this pre-fetch cannot turn the command's own internal lookups into cache
  // hits; it only earns its keep as the fail-fast pre-validation used below.
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
  const existingSlugs = distinctSlugs.length
    ? new Set(
      (await em.find(CatalogProductCategory, {
        slug: { $in: distinctSlugs },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })).map((category) => category.slug as string),
    )
    : new Set<string>()
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

  const commandContext = buildCommandContext(scope, container)
  // Seeded from the previous attempt's checkpoint so a resumed run's summary covers the whole
  // batch. Counting only from `startIndex` would silently drop every row completed before the
  // last durable checkpoint, reporting e.g. 40 created for a 100-row batch that fully succeeded.
  const createdIds: string[] = [...priorCheckpoint.createdIds]
  const failedItems: CatalogCategoryBulkCreateFailure[] = [...priorCheckpoint.failedItems]
  let createdCount = priorCheckpoint.createdCount

  // `ProgressService.updateProgress` persists on an internal throttle (at most
  // once per HEARTBEAT_INTERVAL_MS, or sooner on a >=1% progress change), not on
  // every call, so the durably-persisted `lastCompletedRowIndex` can legitimately
  // lag further behind the in-memory processing position than the nominal
  // checkpoint interval. Rather than assume a fixed replay window, every row from
  // `startIndex` is pre-checked against its natural key until the first row that
  // was NOT already created by a previous attempt — rows are created in array
  // order, so once one resumed row is confirmed genuinely new, every later row is
  // too and the natural-key pre-check is skipped for the rest of the run.
  let resumeBoundaryReached = startIndex === 0

  const buildSummary = (): CatalogCategoryBulkCreateSummary => ({
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

    if (!resumeBoundaryReached) {
      const alreadyCreated = slug
        ? await em.findOne(CatalogProductCategory, {
          slug,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
        : await em.findOne(CatalogProductCategory, {
          name: row.name,
          parentId: row.parentId ? String(row.parentId) : null,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
      if (alreadyCreated) {
        createdIds.push(alreadyCreated.id)
        createdCount += 1
        if (slug) existingSlugs.add(slug)
        await checkpoint(index)
        continue
      }
      resumeBoundaryReached = true
    }

    if (slug && existingSlugs.has(slug)) {
      failedItems.push({
        index,
        name: row.name,
        code: 'slug_taken',
        message: 'Category slug already exists for this organization.',
      })
      await checkpoint(index)
      continue
    }
    if (row.parentId && !existingParentIds.has(String(row.parentId))) {
      failedItems.push({
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
      }
    } catch (error) {
      failedItems.push({
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
