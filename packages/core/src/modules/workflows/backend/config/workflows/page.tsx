import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CommandSettingsPageClient } from '../../../components/settings/CommandSettingsPageClient'

export default async function WorkflowCommandSettingsPage() {
  return (
    <Page>
      <PageBody>
        <CommandSettingsPageClient />
      </PageBody>
    </Page>
  )
}
