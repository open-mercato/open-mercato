import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { NotificationUserPreferencesAdminPageClient } from '../../../frontend/NotificationUserPreferencesAdminPageClient'

export default async function NotificationUserPreferencesAdminPage() {
  return (
    <Page>
      <PageBody>
        <NotificationUserPreferencesAdminPageClient />
      </PageBody>
    </Page>
  )
}
