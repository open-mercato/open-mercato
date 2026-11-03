import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TodoCreateForm } from '../../../components/TodoForm'

export default function CreateTodoPage() {
  return (
    <Page>
      <PageBody>
        <TodoCreateForm />
      </PageBody>
    </Page>
  )
}
