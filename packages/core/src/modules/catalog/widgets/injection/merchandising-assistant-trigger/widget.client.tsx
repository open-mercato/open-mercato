"use client"

/**
 * Step 5.15 — Catalog merchandising AiChat injection widget.
 *
 * Reuses the Step 4.9 `MerchandisingAssistantSheet` component but loads
 * it through the widget-injection system instead of being imported
 * directly from the products list page. `pageContext` follows spec §10.1
 * exactly and is derived from the DataTable's injection context (filter
 * snapshot + total-matching count). Selection data is not exposed by the
 * shared DataTable today (Phase 2 contract); `selectedCount` ships as 0
 * until the host lifts selection into injection context.
 */

import * as React from 'react'
import MerchandisingAssistantSheet, {
  type MerchandisingPageContext,
  type MerchandisingPageContextFilter,
} from '../../../backend/catalog/products/MerchandisingAssistantSheet'

interface HostInjectionContext {
  search?: string
  filters?: {
    categoryIds?: unknown
    tagIds?: unknown
    status?: unknown
  }
  customFieldset?: string | null
  page?: number
  sorting?: unknown
  scopeVersion?: unknown
  total?: number | string
  totalMatching?: number | string
}

interface MerchandisingAssistantTriggerProps {
  context?: HostInjectionContext
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function normalizeFilters(context: HostInjectionContext | undefined): MerchandisingPageContextFilter {
  const rawCategories = context?.filters?.categoryIds
  const categoryIds = Array.isArray(rawCategories) ? rawCategories : []
  const firstCategoryId = categoryIds
    .map(readString)
    .find((value): value is string => value !== null && value.length > 0) ?? null

  const rawTags = context?.filters?.tagIds
  const tags = Array.isArray(rawTags)
    ? rawTags.map(readString).filter((value): value is string => value !== null)
    : []

  const status = readString(context?.filters?.status)

  return {
    categoryId: firstCategoryId,
    priceRange: null,
    tags,
    status,
  }
}

/**
 * Exposed for unit tests so the page-context derivation is exercisable
 * without mounting the widget.
 */
export function computeCatalogMerchandisingPageContext(
  context: HostInjectionContext | undefined,
): MerchandisingPageContext {
  const totalMatching = readNumber(context?.totalMatching ?? context?.total)
  return {
    view: 'catalog.products.list',
    recordType: null,
    recordId: '',
    extra: {
      filter: normalizeFilters(context),
      totalMatching,
      selectedCount: 0,
    },
  }
}

export default function MerchandisingAssistantTriggerWidget({
  context,
}: MerchandisingAssistantTriggerProps) {
  const pageContext = React.useMemo(
    () => computeCatalogMerchandisingPageContext(context),
    [context],
  )
  return <MerchandisingAssistantSheet pageContext={pageContext} />
}
