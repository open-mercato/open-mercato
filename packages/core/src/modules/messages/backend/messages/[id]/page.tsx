import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { MessageDetailPageClient } from '../../../components/MessageDetailPageClient'
import { resolveCanViewMessagesForCurrentUser } from '../../../lib/access'

export default async function MessageDetailPage({ params }: { params: { id: string } }) {
  const canViewMessages = await resolveCanViewMessagesForCurrentUser()
  return (
    <Page>
      <PageBody>
        <MessageDetailPageClient id={params.id} canViewMessages={canViewMessages} />
      </PageBody>
    </Page>
  )
}
