import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttendanceCreateForm } from '../../../../components/AttendanceForm'

export default function HrAttendanceCreatePage() {
  return (
    <Page>
      <PageBody>
        <AttendanceCreateForm />
      </PageBody>
    </Page>
  )
}
