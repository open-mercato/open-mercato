import type { CatalogProductCategorySuggestion } from '../../data/entities'

export type SerializedCategorySuggestion = {
  id: string
  productId: string
  organizationId: string
  tenantId: string
  outcome: string
  categoryId: string | null
  categoryPathIds: string[]
  confidence: number | null
  levels: unknown
  status: string
  trigger: string
  provider: string | null
  model: string | null
  promptVersion: string | null
  costUsd: number | null
  durationMs: number | null
  requestedByUserId: string | null
  reviewedByUserId: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export function serializeCategorySuggestion(
  suggestion: CatalogProductCategorySuggestion,
): SerializedCategorySuggestion {
  const productId = typeof suggestion.product === 'string' ? suggestion.product : suggestion.product?.id
  return {
    id: suggestion.id,
    productId: String(productId),
    organizationId: suggestion.organizationId,
    tenantId: suggestion.tenantId,
    outcome: suggestion.outcome,
    categoryId: suggestion.categoryId ?? null,
    categoryPathIds: suggestion.categoryPathIds ?? [],
    confidence: suggestion.confidence != null ? Number(suggestion.confidence) : null,
    levels: suggestion.levels ?? [],
    status: suggestion.status,
    trigger: suggestion.trigger,
    provider: suggestion.provider ?? null,
    model: suggestion.model ?? null,
    promptVersion: suggestion.promptVersion ?? null,
    costUsd: suggestion.costUsd != null ? Number(suggestion.costUsd) : null,
    durationMs: suggestion.durationMs ?? null,
    requestedByUserId: suggestion.requestedByUserId ?? null,
    reviewedByUserId: suggestion.reviewedByUserId ?? null,
    reviewedAt: suggestion.reviewedAt ? suggestion.reviewedAt.toISOString() : null,
    createdAt: suggestion.createdAt.toISOString(),
    updatedAt: suggestion.updatedAt.toISOString(),
  }
}
