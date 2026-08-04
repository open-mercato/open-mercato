import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiModerationFlagsPageClient } from './AiModerationFlagsPageClient'

export default async function AiModerationFlagsPage() {
  return (
    <Page>
      <PageBody>
        <AiModerationFlagsPageClient />
      </PageBody>
    </Page>
  )
}
