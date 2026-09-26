import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import EmployeesTable from '../../../components/EmployeesTable'

export default function HrEmployeesPage() {
  return (
    <Page>
      <PageBody>
        <EmployeesTable />
      </PageBody>
    </Page>
  )
}
