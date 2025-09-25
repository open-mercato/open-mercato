"use client"
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'

type TodoItem = TodoListItem

export default function EditTodoPage(props: { params?: { id?: string | string[] } }) {
  // Prefer params passed by registry; fallback to Next hook if missing
  const hookParams = useParams<{ id?: string | string[] }>()
  const router = useRouter()
  const idParam = (props?.params?.id ?? hookParams?.id) as string | string[] | undefined
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  const [initial, setInitial] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<CrudField[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setLoading(true)
      setErr(null)
      try {
        const [defsRes, data] = await Promise.all([
          fetch(`/api/custom_fields/definitions?entityId=example:todo`).then((r) => r.json()).catch(() => ({ items: [] })),
          fetchCrudList<TodoItem>('example/todos', { id: String(id), pageSize: 1 }),
        ])
        const t = data?.items?.[0]
        if (!t) throw new Error('Not found')
        const defs: Array<{ key: string; kind: string; label?: string; description?: string; options?: string[]; multi?: boolean; formEditable?: boolean }> = defsRes?.items || []
        const out: CrudField[] = []
        out.push({ id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' })
        for (const d of defs) {
          if (!d.formEditable) continue
          const id = `cf_${d.key}`
          const label = d.label || d.key
          if (d.kind === 'boolean') out.push({ id, label, type: 'checkbox', description: d.description })
          else if (d.kind === 'integer' || d.kind === 'float') out.push({ id, label, type: 'number', description: d.description })
          else if (d.kind === 'multiline') out.push({ id, label, type: 'textarea', description: d.description })
          else if (d.kind === 'select') {
            const options = (d.options || []).map((o) => ({ value: o, label: o[0]?.toUpperCase() + o.slice(1) }))
            out.push({ id, label, type: 'select', options, multiple: !!d.multi, description: d.description })
          } else out.push({ id, label, type: 'text', description: d.description })
        }
        out.push({ id: 'is_done', label: 'Done', type: 'checkbox' })
        if (!cancelled) setFields(out)
        // Map to form initial values
        const cfInit: Record<string, any> = {}
        for (const d of defs) {
          const key = `cf_${d.key}`
          const val = (t as any)[key]
          cfInit[key] = val == null ? (d.multi ? [] : undefined) : val
        }
        const init = { id: t.id, title: t.title, is_done: !!t.is_done, ...cfInit }
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
            fields={fields}
            initialValues={initial || { id }}
            submitLabel="Save Changes"
            cancelHref="/backend/todos"
            successRedirect="/backend/todos"
            onSubmit={async (vals) => { await updateCrud('example/todos', vals) }}
          />
        )}
      </PageBody>
    </Page>
  )
}
