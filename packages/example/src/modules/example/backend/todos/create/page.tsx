"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'

const todoCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  is_done: z.boolean().optional().default(false),
  cf_severity: z.enum(['low', 'medium', 'high']).optional(),
  cf_blocked: z.boolean().optional(),
})

const fields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
  { id: 'cf_severity', label: 'Severity', type: 'select', options: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ]},
  { id: 'cf_blocked', label: 'Blocked', type: 'checkbox' },
  { id: 'is_done', label: 'Done', type: 'checkbox' },
]

export default function CreateTodoPage() {
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Todo"
          backHref="/backend/todos"
          schema={todoCreateSchema}
          fields={fields}
          submitLabel="Create Todo"
          cancelHref="/backend/todos"
          successRedirect="/backend/todos"
          onSubmit={async (vals) => {
            await fetch('/api/example/todos', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(vals),
            }).then(async (res) => {
              if (!res.ok) {
                const t = await res.text().catch(() => '')
                throw new Error(t || 'Failed to create')
              }
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
