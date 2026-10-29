import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductCategorySuggestion,
} from '../data/entities'
import { syncCategoryAssignments } from './products'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { emitCatalogEvent } from '../events'

const acceptSuggestionInputSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  makeMain: z.boolean().default(false),
})
type AcceptSuggestionInput = z.infer<typeof acceptSuggestionInputSchema>

const rejectSuggestionInputSchema = z.object({ id: z.string().uuid() })
type RejectSuggestionInput = z.infer<typeof rejectSuggestionInputSchema>

type AcceptSuggestionResult = {
  suggestionId: string
  productId: string
  tenantId: string
  organizationId: string
  categoryIdsBefore: string[]
  categoryIdsAfter: string[]
  product: { id: string; categoryIds: string[]; updatedAt: string }
}

type RejectSuggestionResult = {
  suggestionId: string
  productId: string
  tenantId: string
  organizationId: string
}

type AcceptUndoPayload = {
  suggestionId: string
  productId: string
  before: { categoryIds: string[] }
}

type ReviewUndoPayload = {
  suggestionId: string
  productId: string
}

const productUpdatedEvents: CrudEventsConfig<CatalogProduct> = {
  module: 'catalog',
  entity: 'product',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    productType: ctx.entity.productType,
    statusEntryId: ctx.entity.statusEntryId ?? null,
    isActive: ctx.entity.isActive,
  }),
}

const productUpdatedIndexer: CrudIndexerConfig<CatalogProduct> = {
  entityType: E.catalog.catalog_product,
  buildUpsertPayload: (ctx) => ({
    entityType: E.catalog.catalog_product,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.catalog.catalog_product,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

function productIdentifiers(product: CatalogProduct) {
  return { id: product.id, organizationId: product.organizationId, tenantId: product.tenantId }
}

async function loadCurrentCategoryIds(
  em: EntityManager,
  product: CatalogProduct,
): Promise<string[]> {
  const assignments = await findWithDecryption(
    em,
    CatalogProductCategoryAssignment,
    { product: product.id },
    { populate: ['category'] },
    { tenantId: product.tenantId, organizationId: product.organizationId },
  )
  return assignments
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((assignment) => (typeof assignment.category === 'string' ? assignment.category : assignment.category?.id))
    .filter((id): id is string => !!id)
}

/** D5 merge: empty product -> only category; otherwise appended last, or first with `makeMain`. */
function mergeAcceptedCategory(current: string[], categoryId: string, makeMain: boolean): string[] {
  const withoutDuplicate = current.filter((id) => id !== categoryId)
  if (withoutDuplicate.length === 0) return [categoryId]
  return makeMain ? [categoryId, ...withoutDuplicate] : [...withoutDuplicate, categoryId]
}

/**
 * Restores a reviewed suggestion to `pending` after an undo — unless a newer
 * pending suggestion now exists for the same product, in which case it is set
 * to `superseded` instead, avoiding a unique-constraint violation on the
 * partial `(product_id) WHERE status = 'pending'` index.
 */
async function restoreSuggestionAfterUndo(
  em: EntityManager,
  suggestionId: string,
  productId: string,
): Promise<void> {
  const suggestion = await em.findOne(CatalogProductCategorySuggestion, { id: suggestionId })
  if (!suggestion) return
  const newerPendingCount = await em.count(CatalogProductCategorySuggestion, {
    product: productId,
    status: 'pending',
    id: { $ne: suggestionId },
  })
  suggestion.status = newerPendingCount > 0 ? 'superseded' : 'pending'
  await em.flush()
}

const acceptCategorySuggestionCommand: CommandHandler<AcceptSuggestionInput, AcceptSuggestionResult> = {
  id: 'catalog.category_suggestions.accept',
  async execute(rawInput, ctx) {
    const parsed = acceptSuggestionInputSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const suggestion = await em.findOne(CatalogProductCategorySuggestion, { id: parsed.id }, { populate: ['product'] })
    if (!suggestion) throw new CrudHttpError(404, { error: 'Catalog category suggestion not found' })
    ensureTenantScope(ctx, suggestion.tenantId)
    ensureOrganizationScope(ctx, suggestion.organizationId)

    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'catalog.category_suggestion',
      resourceId: suggestion.id,
      current: suggestion.updatedAt,
      request: ctx.request ?? null,
    })

    if (suggestion.status !== 'pending') {
      throw new CrudHttpError(409, { code: 'suggestion_not_pending' })
    }

    const categoryId = parsed.categoryId ?? suggestion.categoryId ?? null
    if (!categoryId) {
      throw new CrudHttpError(422, { code: 'category_unavailable' })
    }

    const product = typeof suggestion.product === 'string'
      ? await em.findOne(CatalogProduct, { id: suggestion.product })
      : suggestion.product
    if (!product) throw new CrudHttpError(404, { error: 'Catalog product not found' })

    const category = await em.findOne(CatalogProductCategory, {
      id: categoryId,
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      deletedAt: null,
      isActive: true,
    })
    if (!category) {
      throw new CrudHttpError(422, { code: 'category_unavailable' })
    }

    const before = await loadCurrentCategoryIds(em, product)
    const after = mergeAcceptedCategory(before, categoryId, parsed.makeMain)

    await syncCategoryAssignments(em, product, after)
    product.updatedAt = new Date()
    suggestion.status = 'accepted'
    suggestion.reviewedByUserId = ctx.auth?.sub ?? null
    suggestion.reviewedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: product,
      identifiers: productIdentifiers(product),
      events: productUpdatedEvents,
      indexer: productUpdatedIndexer,
    })
    await emitCatalogEvent('catalog.category_suggestion.accepted', {
      id: suggestion.id,
      productId: product.id,
      categoryId,
      status: suggestion.status,
      confidence: suggestion.confidence != null ? Number(suggestion.confidence) : null,
    }, { tenantId: suggestion.tenantId, organizationId: suggestion.organizationId })

    return {
      suggestionId: suggestion.id,
      productId: product.id,
      tenantId: suggestion.tenantId,
      organizationId: suggestion.organizationId,
      categoryIdsBefore: before,
      categoryIdsAfter: after,
      product: { id: product.id, categoryIds: after, updatedAt: product.updatedAt.toISOString() },
    }
  },
  buildLog: async ({ result }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.categorySuggestions.accept', 'Accept AI category suggestion'),
      resourceKind: 'catalog.category_suggestion',
      resourceId: result.suggestionId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      payload: {
        undo: {
          suggestionId: result.suggestionId,
          productId: result.productId,
          before: { categoryIds: result.categoryIdsBefore },
        } satisfies AcceptUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AcceptUndoPayload>(logEntry)
    if (!payload?.suggestionId || !payload?.productId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const product = await em.findOne(CatalogProduct, { id: payload.productId })
    if (!product) return
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

    await syncCategoryAssignments(em, product, payload.before?.categoryIds ?? [])
    product.updatedAt = new Date()
    await em.flush()
    await restoreSuggestionAfterUndo(em, payload.suggestionId, payload.productId)

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: product,
      identifiers: productIdentifiers(product),
      events: productUpdatedEvents,
      indexer: productUpdatedIndexer,
    })
  },
}

const rejectCategorySuggestionCommand: CommandHandler<RejectSuggestionInput, RejectSuggestionResult> = {
  id: 'catalog.category_suggestions.reject',
  async execute(rawInput, ctx) {
    const parsed = rejectSuggestionInputSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const suggestion = await em.findOne(CatalogProductCategorySuggestion, { id: parsed.id })
    if (!suggestion) throw new CrudHttpError(404, { error: 'Catalog category suggestion not found' })
    ensureTenantScope(ctx, suggestion.tenantId)
    ensureOrganizationScope(ctx, suggestion.organizationId)

    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'catalog.category_suggestion',
      resourceId: suggestion.id,
      current: suggestion.updatedAt,
      request: ctx.request ?? null,
    })

    if (suggestion.status !== 'pending') {
      throw new CrudHttpError(409, { code: 'suggestion_not_pending' })
    }

    const productId = typeof suggestion.product === 'string' ? suggestion.product : suggestion.product
    suggestion.status = 'rejected'
    suggestion.reviewedByUserId = ctx.auth?.sub ?? null
    suggestion.reviewedAt = new Date()
    await em.flush()

    await emitCatalogEvent('catalog.category_suggestion.rejected', {
      id: suggestion.id,
      productId: String(productId),
      categoryId: suggestion.categoryId ?? null,
      status: suggestion.status,
      confidence: suggestion.confidence != null ? Number(suggestion.confidence) : null,
    }, { tenantId: suggestion.tenantId, organizationId: suggestion.organizationId })

    return {
      suggestionId: suggestion.id,
      productId: String(productId),
      tenantId: suggestion.tenantId,
      organizationId: suggestion.organizationId,
    }
  },
  buildLog: async ({ result }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.categorySuggestions.reject', 'Reject AI category suggestion'),
      resourceKind: 'catalog.category_suggestion',
      resourceId: result.suggestionId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      payload: {
        undo: {
          suggestionId: result.suggestionId,
          productId: result.productId,
        } satisfies ReviewUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReviewUndoPayload>(logEntry)
    if (!payload?.suggestionId || !payload?.productId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreSuggestionAfterUndo(em, payload.suggestionId, payload.productId)
  },
}

registerCommand(acceptCategorySuggestionCommand)
registerCommand(rejectCategorySuggestionCommand)

export { acceptCategorySuggestionCommand, rejectCategorySuggestionCommand }
