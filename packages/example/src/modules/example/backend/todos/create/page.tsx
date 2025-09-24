"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'

const todoCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  is_done: z.boolean().optional().default(false),
  cf_severity: z.enum(['low', 'medium', 'high']).optional(),
  cf_blocked: z.boolean().optional(),
  cf_labels: z.array(z.string()).optional(),
  cf_description: z.string().optional(),
  cf_assignee: z.string().optional(),
})

const assigneeLoader = async () => {
  const res = await fetch('/api/example/assignees', { headers: { 'content-type': 'application/json' } })
  if (!res.ok) throw new Error('Failed to load assignees')
  const data = await res.json().catch(() => ({ items: [] }))
  return (data?.items || []) as { value: string; label: string }[]
}

const fields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
  { id: 'cf_severity', label: 'Severity', type: 'select', options: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ], description: 'How severe is this todo?' },
  { id: 'cf_blocked', label: 'Blocked', type: 'checkbox', description: 'Mark if this is currently blocked' },
  { id: 'cf_labels', label: 'Labels', type: 'tags', description: 'Add labels, press Enter to confirm' },
  { id: 'cf_assignee', label: 'Assignee', type: 'relation', placeholder: 'Search people…', description: 'Pick one assignee', loadOptions: assigneeLoader },
  { id: 'cf_description', label: 'Description', type: 'richtext', description: 'Supports basic formatting' },
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
