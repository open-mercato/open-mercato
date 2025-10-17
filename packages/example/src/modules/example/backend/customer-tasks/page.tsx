import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CustomerTodosTable } from '@open-mercato/core/modules/customers/components/CustomerTodosTable'

export default function WorkPlanCustomerTasksPage() {
  return (
    <Page>
      <PageBody>
        <CustomerTodosTable />
      </PageBody>
    </Page>
  )
}
