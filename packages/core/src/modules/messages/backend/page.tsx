import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { MessagesInboxPageClient } from '../components/MessagesInboxPageClient'

export default function MessagesInboxPage() {
  return (
    <Page>
      <PageBody>
        <MessagesInboxPageClient />
      </PageBody>
    </Page>
  )
}
