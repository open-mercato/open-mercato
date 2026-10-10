import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { XraySuggestionsPageClient } from '../../../../components/xray/XraySuggestionsPage.client'

export default function InsightsProcessXraySuggestionsPage() {
  return (
    <Page>
      <PageBody>
        <XraySuggestionsPageClient />
      </PageBody>
    </Page>
  )
}
