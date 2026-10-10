import * as React from 'react'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { XrayProcessListPageClient } from '../../../components/xray/XrayProcessListPage.client'

export default async function InsightsProcessXrayPage() {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageBody>
        <React.Suspense fallback={<LoadingMessage label={translate('insights.xray.ui.loading', 'Loading Process X-Ray…')} />}>
          <XrayProcessListPageClient />
        </React.Suspense>
      </PageBody>
    </Page>
  )
}
