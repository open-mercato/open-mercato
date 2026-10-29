import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CatalogProduct,
  CatalogProductCategorySuggestion,
  type CatalogCategorySuggestionLevel,
  type CatalogCategorySuggestionOutcome,
  type CatalogCategorySuggestionTrigger,
} from '../../data/entities'

export type PersistCategorySuggestionInput = {
  productId: string
  tenantId: string
  organizationId: string
  outcome: CatalogCategorySuggestionOutcome
  categoryId?: string | null
  categoryPathIds?: string[]
  confidence?: number | null
  levels?: CatalogCategorySuggestionLevel[]
  trigger: CatalogCategorySuggestionTrigger
  provider?: string | null
  model?: string | null
  promptVersion?: string | null
  costUsd?: number | null
  durationMs?: number | null
  requestedByUserId?: string | null
}

/**
 * Supersedes the product's current pending suggestion (if any) and inserts
 * the new one, in one transaction behind a row lock on the product (spec §
 * Data Model → Concurrency). A unique-constraint violation on the partial
 * `(product_id) WHERE status = 'pending'` index — a cross-node race — maps to
 * `409 { code: 'suggestion_in_progress' }` instead of a 500.
 */
export async function persistCategorySuggestion(
  em: EntityManager,
  input: PersistCategorySuggestionInput,
): Promise<CatalogProductCategorySuggestion> {
  return em.transactional(async (trx) => {
    const product = await trx.findOne(
      CatalogProduct,
      { id: input.productId, organizationId: input.organizationId, tenantId: input.tenantId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    if (!product) {
      throw new CrudHttpError(404, { error: 'Catalog product not found' })
    }

    const pending = await trx.find(CatalogProductCategorySuggestion, {
      product: product.id,
      status: 'pending',
    })
    for (const row of pending) {
      row.status = 'superseded'
    }

    const suggestion = trx.create(CatalogProductCategorySuggestion, {
      product,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      outcome: input.outcome,
      categoryId: input.categoryId ?? null,
      categoryPathIds: input.categoryPathIds ?? [],
      confidence: input.confidence != null ? input.confidence.toFixed(4) : null,
      levels: input.levels ?? [],
      status: 'pending',
      trigger: input.trigger,
      provider: input.provider ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      costUsd: input.costUsd != null ? input.costUsd.toFixed(6) : null,
      durationMs: input.durationMs ?? null,
      requestedByUserId: input.requestedByUserId ?? null,
    })
    trx.persist(suggestion)

    try {
      await trx.flush()
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new CrudHttpError(409, { code: 'suggestion_in_progress' })
      }
      throw error
    }

    return suggestion
  })
}
