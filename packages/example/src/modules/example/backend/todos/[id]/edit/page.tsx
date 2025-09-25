"use client"
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
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
  const baseFields: CrudField[] = [
    { id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' },
    { id: 'is_done', label: 'Done', type: 'checkbox' },
  ]

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
        {loading ? (
          <div>Loading…</div>
        ) : err ? (
          <div className="text-red-600">{err}</div>
        ) : (
          <CrudForm
            title="Edit Todo"
            backHref="/backend/todos"
            entityId="example:todo"
            fields={baseFields}
            groups={[
              { id: 'details', title: 'Details', column: 1, fields: ['title'] },
              { id: 'status', title: 'Status', column: 2, fields: ['is_done'] },
              { id: 'attributes', title: 'Attributes', column: 2, kind: 'customFields' },
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
            ] as CrudFormGroup[]}
            initialValues={initial || { id }}
            submitLabel="Save Changes"
            cancelHref="/backend/todos"
            successRedirect="/backend/todos"
            onSubmit={async (vals) => { await updateCrud('example/todos', vals) }}
            onDelete={async () => {
              if (!id) return
              if (!window.confirm('Delete this todo?')) return
              await deleteCrud('example/todos', String(id))
              router.push('/backend/todos?flash=' + encodeURIComponent('Record has been removed') + '&type=success')
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
