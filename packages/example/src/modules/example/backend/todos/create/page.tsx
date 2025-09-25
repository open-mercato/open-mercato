"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'

const baseFields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
  { id: 'is_done', label: 'Done', type: 'checkbox' },
]

export default function CreateTodoPage() {
  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['title'] },
    { id: 'status', title: 'Status', column: 2, fields: ['is_done'] },
    { id: 'attributes', title: 'Attributes', column: 2, kind: 'customFields' },
    {
      id: 'tips',
      title: 'Tips',
      column: 2,
      component: () => (
        <div className="text-sm text-muted-foreground">
          Use clear titles like “Refactor login” or “Ship v1.2.3”.
        </div>
      ),
    },
  ]
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Todo"
          backHref="/backend/todos"
          entityId="example:todo"
          fields={baseFields}
          groups={groups}
          submitLabel="Create Todo"
          cancelHref="/backend/todos"
          successRedirect="/backend/todos?flash=Todo%20created&type=success"
          onSubmit={async (vals) => { await createCrud('example/todos', vals) }}
        />
      </PageBody>
    </Page>
  )
}
