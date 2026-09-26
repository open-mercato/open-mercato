import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttendanceEditForm } from '../../../../../components/AttendanceForm'

export default async function HrAttendanceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <AttendanceEditForm id={id} />
      </PageBody>
    </Page>
  )
}
