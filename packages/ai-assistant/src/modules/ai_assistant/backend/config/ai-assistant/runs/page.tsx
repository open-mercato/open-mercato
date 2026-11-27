import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiRunsListPageClient } from './AiRunsListPageClient'

export default async function AiRunsPage() {
  return (
    <Page>
      <PageBody>
        <AiRunsListPageClient />
      </PageBody>
    </Page>
  )
}
