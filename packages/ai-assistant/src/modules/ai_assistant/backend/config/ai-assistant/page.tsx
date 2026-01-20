import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiAssistantSettingsPageClient } from '../../../frontend/components/AiAssistantSettingsPageClient'

export default async function AiAssistantSettingsPage() {
  return (
    <Page>
      <PageBody>
        <AiAssistantSettingsPageClient />
      </PageBody>
    </Page>
  )
}
