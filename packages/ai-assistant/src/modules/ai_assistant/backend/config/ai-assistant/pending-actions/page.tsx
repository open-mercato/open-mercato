import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PendingActionsPageClient } from './PendingActionsPageClient'

export default async function PendingActionsPage() {
  return (
    <Page>
      <PageBody>
        <PendingActionsPageClient />
      </PageBody>
    </Page>
  )
}
