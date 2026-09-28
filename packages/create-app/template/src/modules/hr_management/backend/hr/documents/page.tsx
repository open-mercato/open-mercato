import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import EmployeeDocumentsTable from '../../../components/EmployeeDocumentsTable'

export default function HrDocumentsPage() {
  return (
    <Page>
      <PageBody>
        <EmployeeDocumentsTable />
      </PageBody>
    </Page>
  )
}
