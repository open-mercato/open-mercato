import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiUsageStatsPageClient } from './AiUsageStatsPageClient'

export default async function AiUsageStatsPage() {
  return (
    <Page>
      <PageBody>
        <AiUsageStatsPageClient />
      </PageBody>
    </Page>
  )
}
