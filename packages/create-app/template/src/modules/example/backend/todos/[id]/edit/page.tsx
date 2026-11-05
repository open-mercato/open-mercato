import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TodoEditForm } from '../../../../components/TodoForm'

export default function EditTodoPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null

  return (
    <Page>
      <PageBody>
        <TodoEditForm id={id} />
      </PageBody>
    </Page>
  )
}
