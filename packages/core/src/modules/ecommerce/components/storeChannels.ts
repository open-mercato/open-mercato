import { z } from 'zod'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

export const CHANNEL_BINDINGS_API_PATH = 'ecommerce/store-channel-bindings'
export const CHANNEL_BINDINGS_API_URL = `/api/${CHANNEL_BINDINGS_API_PATH}`
export const CHANNEL_BINDINGS_PAGE_SIZE = 100
export const ASSORTMENT_COUNT_DEBOUNCE_MS = 400
export const PRICE_SORT_CAP = 5000

export const PRICE_SORT_FALLBACKS = ['approximate', 'unavailable'] as const

export type PriceSortFallback = (typeof PRICE_SORT_FALLBACKS)[number]

export const DEFAULT_PRICE_SORT_FALLBACK: PriceSortFallback = 'approximate'

export const SCOPE_ID_FIELDS = [
  'categoryIds',
  'tagIds',
  'excludeProductIds',
  'excludeCategoryIds',
  'excludeTagIds',
] as const

export type ScopeIdField = (typeof SCOPE_ID_FIELDS)[number]

export type ChannelAssortmentScope = Partial<Record<ScopeIdField, string[]>>

export type ChannelBindingRecord = {
  id: string
  storeId: string
  salesChannelId: string
  priceKindId: string | null
  assortmentScope: ChannelAssortmentScope | null
  priceSortFallback: PriceSortFallback
  isDefault: boolean
  requireAuthentication: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type ChannelBindingListResponse = {
  items: ChannelBindingRecord[]
  total: number
  totalPages: number
}

export type AssortmentCountResult = {
  count: number
  scopeSource: 'saved' | 'draft'
  requireAuthentication: boolean
  reducedByAuthentication: boolean
  countWithoutAuthentication: number
  unindexedCount: number
}

export type AssortmentCountDraft = {
  scope: ChannelAssortmentScope | null
  requireAuthentication: boolean
}

export type ChannelBindingWritePayload = {
  salesChannelId: string
  priceKindId: string | null
  assortmentScope: ChannelAssortmentScope | null
  priceSortFallback: PriceSortFallback
  requireAuthentication: boolean
  isDefault?: boolean
}

export const PRICE_SORT_FALLBACK_LABELS: Record<PriceSortFallback, { key: string; fallback: string }> = {
  approximate: {
    key: 'ecommerce.backend.store.channels.priceSortFallback.approximate',
    fallback: 'Approximate order from the default price kind',
  },
  unavailable: {
    key: 'ecommerce.backend.store.channels.priceSortFallback.unavailable',
    fallback: 'Withdraw price sorting',
  },
}

export const PRICE_SORT_FALLBACK_VARIANTS: Record<PriceSortFallback, StatusBadgeVariant> = {
  approximate: 'neutral',
  unavailable: 'info',
}

export function isPriceSortFallback(value: unknown): value is PriceSortFallback {
  return typeof value === 'string' && (PRICE_SORT_FALLBACKS as readonly string[]).includes(value)
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    ids.push(trimmed)
  }
  return ids
}

/**
 * Builds the `assortment_scope` sent to the server from the picker values. A cleared picker is
 * omitted rather than sent as `[]`, and a scope with every picker cleared is `null` (no
 * restriction), so clearing never reads as "hide everything" (US-E1).
 */
export function buildAssortmentScope(values: Partial<Record<ScopeIdField, unknown>>): ChannelAssortmentScope | null {
  const scope: ChannelAssortmentScope = {}
  for (const field of SCOPE_ID_FIELDS) {
    const ids = normalizeIds(values[field])
    if (ids.length > 0) scope[field] = ids
  }
  return Object.keys(scope).length > 0 ? scope : null
}

export function countScopeRules(scope: ChannelAssortmentScope | null | undefined): number {
  if (!scope) return 0
  return SCOPE_ID_FIELDS.reduce((total, field) => total + (scope[field]?.length ?? 0), 0)
}

export function buildChannelBindingInitialValues(
  binding: ChannelBindingRecord | null,
  options: { firstBinding: boolean },
): ChannelBindingFormValues {
  const scope = binding?.assortmentScope ?? null
  return {
    salesChannelId: binding?.salesChannelId ?? '',
    priceKindId: binding?.priceKindId ?? '',
    isDefault: binding ? binding.isDefault : options.firstBinding,
    requireAuthentication: binding?.requireAuthentication ?? false,
    priceSortFallback: isPriceSortFallback(binding?.priceSortFallback)
      ? binding.priceSortFallback
      : DEFAULT_PRICE_SORT_FALLBACK,
    categoryIds: normalizeIds(scope?.categoryIds),
    tagIds: normalizeIds(scope?.tagIds),
    excludeProductIds: normalizeIds(scope?.excludeProductIds),
    excludeCategoryIds: normalizeIds(scope?.excludeCategoryIds),
    excludeTagIds: normalizeIds(scope?.excludeTagIds),
  }
}

function buildWritePayload(values: ChannelBindingFormValues): ChannelBindingWritePayload {
  const priceKindId = typeof values.priceKindId === 'string' ? values.priceKindId.trim() : ''
  return {
    salesChannelId: values.salesChannelId.trim(),
    priceKindId: priceKindId.length > 0 ? priceKindId : null,
    assortmentScope: buildAssortmentScope(values),
    priceSortFallback: isPriceSortFallback(values.priceSortFallback) ? values.priceSortFallback : DEFAULT_PRICE_SORT_FALLBACK,
    requireAuthentication: values.requireAuthentication === true,
  }
}

export function buildChannelBindingCreatePayload(
  storeId: string,
  values: ChannelBindingFormValues,
): ChannelBindingWritePayload & { storeId: string; isDefault: boolean } {
  return { storeId, ...buildWritePayload(values), isDefault: values.isDefault === true }
}

/**
 * The default mark is only ever promoted from this form: un-ticking it on the current default
 * would leave the store without a default binding (a `503` for every storefront request), so the
 * update omits `isDefault` unless it asks for the promotion.
 */
export function buildChannelBindingUpdatePayload(
  bindingId: string,
  values: ChannelBindingFormValues,
): ChannelBindingWritePayload & { id: string } {
  const payload: ChannelBindingWritePayload & { id: string } = { id: bindingId, ...buildWritePayload(values) }
  if (values.isDefault === true) payload.isDefault = true
  return payload
}

export function buildAssortmentCountDraft(
  values: Partial<Record<ScopeIdField | 'requireAuthentication', unknown>>,
): AssortmentCountDraft {
  return {
    scope: buildAssortmentScope(values),
    requireAuthentication: values.requireAuthentication === true,
  }
}

export function buildAssortmentCountUrl(bindingId: string, draft: AssortmentCountDraft | null): string {
  const base = `${CHANNEL_BINDINGS_API_URL}/${encodeURIComponent(bindingId)}/assortment-count`
  if (!draft) return base
  const params = new URLSearchParams({
    draftScope: JSON.stringify(draft.scope),
    draftRequireAuthentication: draft.requireAuthentication ? 'true' : 'false',
  })
  return `${base}?${params.toString()}`
}

const REQUIRED_MESSAGE = 'ui.forms.errors.required'

export const channelBindingFormSchema = z.object({
  salesChannelId: z.string().trim().min(1, REQUIRED_MESSAGE),
  priceKindId: z.string().default(''),
  isDefault: z.boolean().default(false),
  requireAuthentication: z.boolean().default(false),
  priceSortFallback: z.enum(PRICE_SORT_FALLBACKS).default(DEFAULT_PRICE_SORT_FALLBACK),
  categoryIds: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  excludeProductIds: z.array(z.string()).default([]),
  excludeCategoryIds: z.array(z.string()).default([]),
  excludeTagIds: z.array(z.string()).default([]),
})

export type ChannelBindingFormValues = z.infer<typeof channelBindingFormSchema>
