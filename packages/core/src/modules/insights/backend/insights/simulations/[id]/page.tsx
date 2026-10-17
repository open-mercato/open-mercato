import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SimulationRunPageClient } from '../../../../components/simulation/SimulationRunPage.client'

export default function InsightsSimulationRunPage({ params }: { params?: { id?: string } }) {
  const runId = typeof params?.id === 'string' ? params.id : ''
  return (
    <Page>
      <PageBody>
        <SimulationRunPageClient key={runId} runId={runId} />
      </PageBody>
    </Page>
  )
}
