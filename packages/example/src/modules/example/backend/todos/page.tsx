import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import TodosTable from '../../components/TodosTable'

export default function ExampleTodosPage() {
  return (
    <Page>
      <PageHeader title="Todos" description="Example todos with custom fields (priority, severity, blocked)" />
      <PageBody>
        <TodosTable />
      </PageBody>
    </Page>
  )
}
