"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'

type TodoItem = TodoListItem

export default function EditTodoPage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const id = params?.id
  const [initial, setInitial] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  // Memoize fields to avoid recreating arrays/objects each render (prevents focus loss)
  const baseFields = React.useMemo<CrudField[]>(() => [
    { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
    { id: 'is_done', label: 'Done', type: 'checkbox' },
  ], [])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', title: 'Details', column: 1, fields: ['title'] },
    { id: 'status', title: 'Status', column: 2, fields: ['is_done'] },
    { id: 'attributes', title: 'Attributes', column: 1, kind: 'customFields' },
    {
      id: 'actions',
      title: 'Quick Actions',
      column: 2,
      component: ({ values, setValue }) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded border px-2 text-sm"
            onClick={() => setValue('is_done', true)}
          >
            Mark as done
          </button>
          <button
            type="button"
            className="h-8 rounded border px-2 text-sm"
            onClick={() => setValue('is_done', false)}
          >
            Mark as todo
          </button>
        </div>
      ),
    },
  ], [])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setLoading(true)
      setErr(null)
      try {
        const data = await fetchCrudList<TodoItem>('example/todos', { id: String(id), pageSize: 1 })
        const t = data?.items?.[0]
        if (!t) throw new Error('Not found')
        // Map to form initial values
        const cfInit: Record<string, any> = {}
        for (const [k, v] of Object.entries(t as any)) if (k.startsWith('cf_')) cfInit[k] = v
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
        {err ? (
          <div className="text-red-600">{err}</div>
        ) : (
          <CrudForm
            title="Edit Todo"
            backHref="/backend/todos"
            entityId="example:todo"
            fields={baseFields}
            groups={groups}
            initialValues={(initial || { id }) as any}
            submitLabel="Save"
            cancelHref="/backend/todos"
            successRedirect="/backend/todos?flash=Todo%20saved&type=success"
            isLoading={loading}
            loadingMessage="Loading data..."
            onSubmit={async (vals) => { await updateCrud('example/todos', vals) }}
            onDelete={async () => {
              if (!id) return
              if (!window.confirm('Delete this todo?')) return
              await deleteCrud('example/todos', String(id))
              pushWithFlash(router as any, '/backend/todos', 'Record has been removed', 'success')
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
