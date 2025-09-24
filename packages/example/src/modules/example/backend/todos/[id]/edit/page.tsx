"use client"
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'

const todoUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  is_done: z.boolean().optional(),
  cf_severity: z.enum(['low', 'medium', 'high']).optional(),
  cf_blocked: z.boolean().optional(),
  cf_labels: z.array(z.string()).optional(),
  cf_description: z.string().optional(),
  cf_assignee: z.string().optional(),
})

const assigneeLoader = async () => {
  const res = await fetch('/api/example/assignees', { headers: { 'content-type': 'application/json' } })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({ items: [] }))
  return (data?.items || []) as { value: string; label: string }[]
}

const fields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
  { id: 'cf_severity', label: 'Severity', type: 'select', options: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ] },
  { id: 'cf_blocked', label: 'Blocked', type: 'checkbox' },
  { id: 'cf_labels', label: 'Labels', type: 'tags' },
  { id: 'cf_assignee', label: 'Assignee', type: 'relation', placeholder: 'Search people…', loadOptions: assigneeLoader },
  { id: 'cf_description', label: 'Description', type: 'richtext' },
  { id: 'is_done', label: 'Done', type: 'checkbox' },
]

export default function EditTodoPage(props: { params?: { id?: string | string[] } }) {
  // Prefer params passed by registry; fallback to Next hook if missing
  const hookParams = useParams<{ id?: string | string[] }>()
  const router = useRouter()
  const idParam = (props?.params?.id ?? hookParams?.id) as string | string[] | undefined
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  const [initial, setInitial] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch(`/api/example/todos?id=${encodeURIComponent(String(id))}&pageSize=1`)
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        const t = data?.items?.[0]
        if (!t) throw new Error('Not found')
        // Map to form initial values
        const init = {
          id: t.id,
          title: t.title,
          is_done: !!t.is_done,
          cf_severity: t.cf_severity || undefined,
          cf_blocked: !!t.cf_blocked,
          cf_labels: Array.isArray(t.cf_labels) ? t.cf_labels : [],
          cf_description: t.cf_description || undefined,
          cf_assignee: t.cf_assignee || undefined,
        }
        if (!cancelled) setInitial(init)
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  if (!id) return null

  return (
    <Page>
      <PageBody>
        {loading ? (
          <div>Loading…</div>
        ) : err ? (
          <div className="text-red-600">{err}</div>
        ) : (
          <CrudForm
            title="Edit Todo"
            backHref="/backend/todos"
            schema={todoUpdateSchema}
            fields={fields}
            initialValues={initial || { id }}
            submitLabel="Save Changes"
            cancelHref="/backend/todos"
            successRedirect="/backend/todos"
            onSubmit={async (vals) => {
              await fetch('/api/example/todos', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(vals),
              }).then(async (res) => {
                if (!res.ok) {
                  const t = await res.text().catch(() => '')
                  throw new Error(t || 'Failed to update')
                }
              })
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
