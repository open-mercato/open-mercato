import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { CatalogProductCategory } from '../data/entities'
import type { CategoryBulkCreateRow } from '../data/validators'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'

export const CATALOG_CATEGORY_BULK_CREATE_QUEUE = 'catalog-category-bulk-create'

const CHECKPOINT_INTERVAL = 20

const queues = new Map<string, Queue<Record<string, unknown>>>()

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
  message: string
}

export type CatalogCategoryBulkCreateSummary = {
  createdCount: number
  failedCount: number
  createdIds: string[]
  failedItems: CatalogCategoryBulkCreateFailure[]
}

export function getCatalogQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.CATALOG_QUEUE_CONCURRENCY ?? '3', 10) || 3)
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })

  queues.set(queueName, created)
  return created
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
  const priorLastCompletedRowIndex = typeof existingJob?.meta?.lastCompletedRowIndex === 'number'
    ? (existingJob.meta.lastCompletedRowIndex as number)
    : -1
  const startIndex = priorLastCompletedRowIndex + 1

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
  const createdIds: string[] = []
  const failedItems: CatalogCategoryBulkCreateFailure[] = []
  const seenSlugsThisBatch = new Set<string>()
  let createdCount = 0

  // `ProgressService.updateProgress` persists on an internal throttle (at most
  // once per HEARTBEAT_INTERVAL_MS, or sooner on a >=1% progress change), not on
  // every call, so the durably-persisted `lastCompletedRowIndex` can legitimately
  // lag further behind the in-memory processing position than the nominal
  // CHECKPOINT_INTERVAL. Rather than assume a fixed replay window, every row from
  // `startIndex` is pre-checked against its natural key until the first row that
  // was NOT already created by a previous attempt — rows are created in array
  // order, so once one resumed row is confirmed genuinely new, every later row is
  // too and the natural-key pre-check is skipped for the rest of the run.
  let resumeBoundaryReached = startIndex === 0

  const checkpoint = async (index: number) => {
    const processedCount = index + 1
    if (processedCount % CHECKPOINT_INTERVAL === 0 || processedCount === items.length) {
      await progressService.updateProgress(
        progressJobId,
        { processedCount, meta: { lastCompletedRowIndex: index } },
        progressContext,
      )
    }
  }

  for (let index = startIndex; index < items.length; index += 1) {
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

    if (slug && (seenSlugsThisBatch.has(slug) || existingSlugs.has(slug))) {
      failedItems.push({ index, name: row.name, message: 'Category slug already exists for this organization.' })
      await checkpoint(index)
      continue
    }
    if (row.parentId && !existingParentIds.has(String(row.parentId))) {
      failedItems.push({ index, name: row.name, message: 'Parent category not found or inaccessible.' })
      await checkpoint(index)
      continue
    }

    const cancelled = await progressService.isCancellationRequested(
      progressJobId,
      scope.tenantId,
      scope.organizationId,
    )
    if (cancelled) {
      const partialSummary: CatalogCategoryBulkCreateSummary = {
        createdCount,
        failedCount: failedItems.length,
        createdIds,
        failedItems,
      }
      await progressService.updateProgress(
        progressJobId,
        { meta: { resultSummary: partialSummary } },
        progressContext,
      )
      await progressService.markCancelled(progressJobId, progressContext)
      return partialSummary
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
        if (slug) {
          existingSlugs.add(slug)
          seenSlugsThisBatch.add(slug)
        }
      }
    } catch (error) {
      failedItems.push({
        index,
        name: row.name,
        message: error instanceof Error ? error.message : 'Category creation failed',
      })
    }

    await checkpoint(index)
  }

  const summary: CatalogCategoryBulkCreateSummary = {
    createdCount,
    failedCount: failedItems.length,
    createdIds,
    failedItems,
  }
  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}
