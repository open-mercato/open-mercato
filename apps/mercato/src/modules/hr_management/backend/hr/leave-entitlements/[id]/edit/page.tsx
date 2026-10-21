import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LeaveEntitlementEditForm } from '../../../../../components/LeaveEntitlementForm'

export default async function HrLeaveEntitlementEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <LeaveEntitlementEditForm id={id} />
      </PageBody>
    </Page>
  )
}
