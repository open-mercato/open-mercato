import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import TodosTable from '../../components/TodosTable'

export default function ExampleTodosPage() {
  return (
    <Page>
      <PageBody>
        <TodosTable />
      </PageBody>
    </Page>
  )
}
