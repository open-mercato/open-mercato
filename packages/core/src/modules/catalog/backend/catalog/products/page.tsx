"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import ProductsDataTable, {
  type ProductsDataTableSnapshot,
} from '../../../components/products/ProductsDataTable'
import MerchandisingAssistantSheet, {
  type MerchandisingPageContext,
  type MerchandisingPageContextFilter,
} from './MerchandisingAssistantSheet'

const REQUIRED_FEATURES = ['catalog.products.view', 'ai_assistant.view']

function normalizeFilters(filterValues: FilterValues): MerchandisingPageContextFilter {
  const categoryRaw = Array.isArray(filterValues.categoryIds) ? filterValues.categoryIds : []
  const firstCategoryId =
    categoryRaw.find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ) ?? null

  const tagsRaw = Array.isArray(filterValues.tagIds) ? filterValues.tagIds : []
  const tags = tagsRaw
    .map((value) => (typeof value === 'string' && value.trim().length > 0 ? value : null))
    .filter((value): value is string => value !== null)

  const statusRaw = filterValues.status
  const status =
    typeof statusRaw === 'string' && statusRaw.trim().length > 0 ? statusRaw.trim() : null

  // No direct price-range filter on the current DataTable; reserved for Step 5.2.
  return {
    categoryId: firstCategoryId,
    priceRange: null,
    tags,
    status,
  }
}

function useMerchandisingAssistantEligibility(): boolean {
  const [granted, setGranted] = React.useState<string[] | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; granted: string[] }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: REQUIRED_FEATURES }),
          },
        )
        if (cancelled) return
        setGranted(res.result?.granted ?? [])
      } catch {
        if (!cancelled) setGranted([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  if (granted === null) return false
  return hasAllFeatures(REQUIRED_FEATURES, granted)
}

export default function CatalogProductsPage() {
  const [snapshot, setSnapshot] = React.useState<ProductsDataTableSnapshot>({
    search: '',
    filterValues: {},
    total: 0,
  })
  const canViewAssistant = useMerchandisingAssistantEligibility()

  const pageContext: MerchandisingPageContext = React.useMemo(
    () => ({
      view: 'catalog.products.list',
      recordType: null,
      // Phase 2: DataTable's internal rowSelection state is not externally
      // observable, so selection tracking ships empty here. Step 5.2 wires
      // server-side hydration; lifting rowSelection can happen as follow-up
      // if per-selection context becomes a hard requirement before Phase 3.
      recordId: '',
      extra: {
        filter: normalizeFilters(snapshot.filterValues),
        totalMatching: snapshot.total,
        selectedCount: 0,
      },
    }),
    [snapshot.filterValues, snapshot.total],
  )

  return (
    <Page>
      <PageBody>
        <ProductsDataTable
          onSnapshotChange={setSnapshot}
          extraActions={
            canViewAssistant ? (
              <MerchandisingAssistantSheet pageContext={pageContext} />
            ) : null
          }
        />
      </PageBody>
    </Page>
  )
}
