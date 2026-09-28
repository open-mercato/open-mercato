import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmployeeDocumentCreateForm } from '../../../../components/EmployeeDocumentForm'

export default function HrDocumentCreatePage() {
  return (
    <Page>
      <PageBody>
        <EmployeeDocumentCreateForm />
      </PageBody>
    </Page>
  )
}
