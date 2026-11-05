"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductsDataTable, {
  type ProductsDataTableSnapshot,
} from '../../../components/products/ProductsDataTable'

/**
 * Step 5.15 — Phase 3 WS-D.
 *
 * The catalog merchandising AI trigger moved behind the widget-injection
 * system and now mounts in `data-table:catalog.products:header`. The
 * products list page no longer imports `MerchandisingAssistantSheet`,
 * `hasAllFeatures`, or the `/api/auth/feature-check` polling helper —
 * feature gating is handled by the injection widget's `features`
 * metadata (`catalog.products.view` + `ai_assistant.view`). The snapshot
 * subscription is kept so host-side observability hooks the DataTable's
 * current filter/total count for future extensions.
 */
export default function CatalogProductsPage() {
  const [, setSnapshot] = React.useState<ProductsDataTableSnapshot>({
    search: '',
    filterValues: {},
    total: 0,
  })

  return (
    <Page>
      <PageBody>
        <ProductsDataTable onSnapshotChange={setSnapshot} />
      </PageBody>
    </Page>
  )
}
