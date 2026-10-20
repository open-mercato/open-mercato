import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { XraySettingsPageClient } from '../../../../components/xray/XraySettingsPage.client'

export default function InsightsProcessXraySettingsPage() {
  return (
    <Page>
      <PageBody>
        <XraySettingsPageClient />
      </PageBody>
    </Page>
  )
}
