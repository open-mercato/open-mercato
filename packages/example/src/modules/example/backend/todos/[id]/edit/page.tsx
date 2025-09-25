"use client"
import * as React from 'react'
import { useParams, useRouter, usePathname } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'

type TodoItem = TodoListItem

export default function EditTodoPage(props: { params?: { id?: string | string[] } }) {
  // Prefer params passed by registry; fallback to Next hook if missing
  const hookParams = useParams<{ id?: string | string[] }>()
  const router = useRouter()
  const pathname = usePathname()
  const idParam = (props?.params?.id ?? hookParams?.id) as string | string[] | undefined
  let id = Array.isArray(idParam) ? idParam[0] : idParam
  // Fallback: derive from pathname when params are missing
  if (!id && typeof pathname === 'string') {
    const m = pathname.match(/\/backend\/todos\/([^/]+)\/edit/)
    if (m) id = m[1]
  }
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

  // Show form immediately with basic data, even if custom fields are still loading
  const showForm = initial !== null || !loading

  if (!id) return null

  return (
    <Page>
      <PageBody>
        {err ? (
          <div className="text-red-600">{err}</div>
        ) : showForm ? (
          <CrudForm
            title="Edit Todo"
            backHref="/backend/todos"
            entityId="example:todo"
            fields={baseFields}
            groups={groups}
            initialValues={initial || { id }}
            submitLabel="Save Changes"
            cancelHref="/backend/todos"
            successRedirect="/backend/todos?flash=Todo%20saved&type=success"
            isLoading={false}
            loadingMessage="Loading todo..."
            onSubmit={async (vals) => { await updateCrud('example/todos', vals) }}
            onDelete={async () => {
              if (!id) return
              if (!window.confirm('Delete this todo?')) return
              await deleteCrud('example/todos', String(id))
              pushWithFlash(router as any, '/backend/todos', 'Record has been removed', 'success')
            }}
          />
        ) : (
          <div className="flex items-center justify-center gap-2 py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            <span className="text-sm text-muted-foreground">Loading todo...</span>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
