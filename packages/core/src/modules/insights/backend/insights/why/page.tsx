import * as React from 'react'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { WhyPageClient } from '../../../components/WhyPage.client'

export default async function InsightsWhyPage() {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageBody>
        <React.Suspense fallback={<LoadingMessage label={translate('insights.why.loading', 'Loading explanation…')} />}>
          <WhyPageClient
            missingRecordState={(
              <TabEmptyState
                title={translate('insights.why.page.missingParams.title', 'Choose a record to explain')}
                description={translate('insights.why.page.missingParams.description', 'Open this page from the "Why?" action of a record.')}
              />
            )}
          />
        </React.Suspense>
      </PageBody>
    </Page>
  )
}
