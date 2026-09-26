import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import LeaveRequestsTable from '../../../components/LeaveRequestsTable'

export default function HrLeaveRequestsPage() {
  return (
    <Page>
      <PageBody>
        <LeaveRequestsTable />
      </PageBody>
    </Page>
  )
}
