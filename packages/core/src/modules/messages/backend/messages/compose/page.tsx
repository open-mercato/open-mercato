import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ComposeMessagePageClient } from '../../../components/ComposeMessagePageClient'
import { resolveCanViewMessagesForCurrentUser } from '../../../lib/access'

export default async function ComposeMessagePage() {
  const canViewMessages = await resolveCanViewMessagesForCurrentUser()
  return (
    <Page>
      <PageBody>
        <ComposeMessagePageClient canViewMessages={canViewMessages} />
      </PageBody>
    </Page>
  )
}
