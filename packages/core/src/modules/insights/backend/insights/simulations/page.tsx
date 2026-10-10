import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SimulationRunsPageClient } from '../../../components/simulation/SimulationRunsPage.client'

export default function InsightsSimulationsPage() {
  return (
    <Page>
      <PageBody>
        <SimulationRunsPageClient />
      </PageBody>
    </Page>
  )
}
