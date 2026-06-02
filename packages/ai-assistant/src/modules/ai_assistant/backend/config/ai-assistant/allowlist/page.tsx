import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiTenantAllowlistPageClient } from './AiTenantAllowlistPageClient'

export default async function AiAssistantAllowlistPage() {
  return (
    <Page>
      <PageBody>
        <AiTenantAllowlistPageClient />
      </PageBody>
    </Page>
  )
}
