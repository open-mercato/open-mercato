"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ServicesDataTable from '../../../components/services/ServicesDataTable'

export default function CatalogServicesPage() {
  return (
    <Page>
      <PageBody>
        <ServicesDataTable />
      </PageBody>
    </Page>
  )
}
