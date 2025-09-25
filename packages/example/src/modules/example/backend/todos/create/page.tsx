"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'

const baseFields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
  { id: 'is_done', label: 'Done', type: 'checkbox' },
]

export default function CreateTodoPage() {
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Todo"
          backHref="/backend/todos"
          entityId="example:todo"
          fields={baseFields}
          submitLabel="Create Todo"
          cancelHref="/backend/todos"
          successRedirect="/backend/todos"
          onSubmit={async (vals) => { await createCrud('example/todos', vals) }}
        />
      </PageBody>
    </Page>
  )
}
