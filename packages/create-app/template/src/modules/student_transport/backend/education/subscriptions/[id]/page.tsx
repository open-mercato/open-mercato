import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SubscriptionDetail from '../../../../components/SubscriptionDetail'

export default async function EducationSubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <SubscriptionDetail id={id} />
      </PageBody>
    </Page>
  )
}
