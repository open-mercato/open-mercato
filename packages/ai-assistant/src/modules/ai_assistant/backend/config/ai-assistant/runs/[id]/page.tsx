import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiRunDetailPageClient } from './AiRunDetailPageClient'

export default function AiRunDetailPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <AiRunDetailPageClient id={params.id} />
      </PageBody>
    </Page>
  )
}
