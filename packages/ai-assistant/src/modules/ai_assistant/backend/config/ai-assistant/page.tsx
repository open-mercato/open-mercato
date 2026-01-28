import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiAssistantSettingsPageClient } from '../../../components/AiAssistantSettingsPageClient'

export default async function AiAssistantSettingsPage() {
  return (
    <Page>
      <PageBody>
        <AiAssistantSettingsPageClient />
      </PageBody>
    </Page>
  )
}
