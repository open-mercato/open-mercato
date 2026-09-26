import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LeaveRequestCreateForm } from '../../../../components/LeaveRequestForm'

export default function HrLeaveRequestCreatePage() {
  return (
    <Page>
      <PageBody>
        <LeaveRequestCreateForm />
      </PageBody>
    </Page>
  )
}
