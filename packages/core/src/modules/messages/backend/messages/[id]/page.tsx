import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { MessageDetailPageClient } from '../../../components/MessageDetailPageClient'

export default async function MessageDetailPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <MessageDetailPageClient id={params.id} />
      </PageBody>
    </Page>
  )
}
