"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductsDataTable from '../../../components/products/ProductsDataTable'

export default function CatalogProductsPage() {
  return (
    <Page>
      <PageBody>
        <ProductsDataTable />
      </PageBody>
    </Page>
  )
}
