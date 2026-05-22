import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiPlaygroundPageClient } from './AiPlaygroundPageClient'

export default async function AiAssistantPlaygroundPage() {
  return (
    <Page>
      <PageBody>
        <AiPlaygroundPageClient />
      </PageBody>
    </Page>
  )
}
