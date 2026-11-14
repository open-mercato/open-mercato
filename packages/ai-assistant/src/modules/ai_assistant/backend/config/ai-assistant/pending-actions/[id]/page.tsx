import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PendingActionDetailPageClient } from './PendingActionDetailPageClient'

export default function PendingActionDetailPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <PendingActionDetailPageClient id={params.id} />
      </PageBody>
    </Page>
  )
}
