import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmployeeCreateForm } from '../../../../components/EmployeeForm'

export default function HrEmployeeCreatePage() {
  return (
    <Page>
      <PageBody>
        <EmployeeCreateForm />
      </PageBody>
    </Page>
  )
}
