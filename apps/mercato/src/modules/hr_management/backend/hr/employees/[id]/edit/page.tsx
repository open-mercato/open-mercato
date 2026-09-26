import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmployeeEditForm } from '../../../../../components/EmployeeForm'

export default async function HrEmployeeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <EmployeeEditForm id={id} />
      </PageBody>
    </Page>
  )
}
