import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SubscriptionEditForm } from '../../../../../components/SubscriptionForm'

export default async function EducationSubscriptionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <SubscriptionEditForm id={id} />
      </PageBody>
    </Page>
  )
}
