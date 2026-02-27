import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { MessagesInboxPageClient } from '../components/MessagesInboxPageClient'
import { resolveCanViewMessagesForCurrentUser } from '../lib/access'

export default async function MessagesInboxPage() {
  const canViewMessages = await resolveCanViewMessagesForCurrentUser()

  return (
    <Page>
      <PageBody>
        <MessagesInboxPageClient canViewMessages={canViewMessages} />
      </PageBody>
    </Page>
  )
}
