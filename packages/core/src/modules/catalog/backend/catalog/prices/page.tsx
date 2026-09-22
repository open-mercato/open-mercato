"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PricesDataTable from '../../../components/prices/PricesDataTable'

export default function CatalogPricesPage() {
  return (
    <Page>
      <PageBody>
        <PricesDataTable />
      </PageBody>
    </Page>
  )
}
