import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LeaveRequestEditForm } from '../../../../../components/LeaveRequestForm'

export default async function HrLeaveRequestEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <LeaveRequestEditForm id={id} />
      </PageBody>
    </Page>
  )
}
