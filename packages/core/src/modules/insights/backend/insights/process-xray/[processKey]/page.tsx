import * as React from 'react'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { XrayProcessPageClient } from '../../../../components/xray/XrayProcessPage.client'
import { decodeProcessKeyParam } from '../../../../lib/client/xray/params'

export default async function InsightsProcessXrayProcessPage({ params }: { params?: { processKey?: string } }) {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageBody>
        <React.Suspense fallback={<LoadingMessage label={translate('insights.xray.ui.loading', 'Loading Process X-Ray…')} />}>
          <XrayProcessPageClient processKey={decodeProcessKeyParam(params?.processKey)} />
        </React.Suspense>
      </PageBody>
    </Page>
  )
}
