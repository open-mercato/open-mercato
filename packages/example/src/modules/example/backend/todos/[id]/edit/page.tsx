"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TodoItem = TodoListItem
type TodoCustomFieldValues = Record<`cf_${string}`, unknown>
type TodoFormValues = {
  id: string
  title: string
  is_done: boolean
} & TodoCustomFieldValues

export default function EditTodoPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = params?.id
  const [initial, setInitial] = React.useState<TodoFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  // Memoize fields to avoid recreating arrays/objects each render (prevents focus loss)
  const baseFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: t('example.todos.form.fields.title.label'),
      type: 'text',
      required: true,
      placeholder: t('example.todos.form.fields.title.placeholder'),
    },
    { id: 'is_done', label: t('example.todos.form.fields.isDone.label'), type: 'checkbox' },
  ], [t])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', title: t('example.todos.form.groups.details'), column: 1, fields: ['title'] },
    { id: 'status', title: t('example.todos.form.groups.status'), column: 2, fields: ['is_done'] },
    { id: 'attributes', title: t('example.todos.form.groups.attributes'), column: 1, kind: 'customFields' },
    {
      id: 'actions',
      title: t('example.todos.form.groups.actions'),
      column: 2,
      component: ({ setValue }) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded border px-2 text-sm"
            onClick={() => setValue('is_done', true)}
          >
            {t('example.todos.form.groups.actions.markDone')}
          </button>
          <button
            type="button"
            className="h-8 rounded border px-2 text-sm"
            onClick={() => setValue('is_done', false)}
          >
            {t('example.todos.form.groups.actions.markTodo')}
          </button>
        </div>
      ),
    },
  ], [t])
  const successRedirect = React.useMemo(
    () => `/backend/todos?flash=${encodeURIComponent(t('example.todos.form.flash.saved'))}&type=success`,
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setLoading(true)
      setErr(null)
      try {
        const data = await fetchCrudList<TodoItem>('example/todos', { id: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) throw new Error(t('example.todos.form.error.notFound'))
        // Map to form initial values
        const cfInit: Partial<TodoCustomFieldValues> = {}
        const extended = item as TodoItem & Record<string, unknown>
        for (const [key, value] of Object.entries(extended)) {
          if (key.startsWith('cf_')) {
            cfInit[key as keyof TodoCustomFieldValues] = value
          }
        }
        const init: TodoFormValues = {
          id: item.id,
          title: item.title,
          is_done: Boolean(item.is_done),
          ...(cfInit as TodoCustomFieldValues),
        }
        if (!cancelled) setInitial(init)
      } catch (error: unknown) {
        if (!cancelled) {
          const message = error instanceof Error && error.message ? error.message : t('example.todos.form.error.load')
          setErr(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const fallbackInitialValues = React.useMemo<TodoFormValues>(() => ({
    id: id ?? '',
    title: '',
    is_done: false,
  }), [id])

  if (!id) return null

  return (
    <Page>
      <PageBody>
        {err ? (
          <div className="text-red-600">{err}</div>
        ) : (
          <CrudForm<TodoFormValues>
            title={t('example.todos.form.edit.title')}
            backHref="/backend/todos"
            entityId="example:todo"
            fields={baseFields}
            groups={groups}
            initialValues={initial ?? fallbackInitialValues}
            submitLabel={t('example.todos.form.edit.submit')}
            cancelHref="/backend/todos"
            successRedirect={successRedirect}
            isLoading={loading}
            loadingMessage={t('example.todos.form.loading')}
            onSubmit={async (vals) => { await updateCrud('example/todos', vals) }}
            onDelete={async () => {
              if (!id) return
              if (!window.confirm(t('example.todos.table.confirm.delete'))) return
              try {
                await deleteCrud('example/todos', String(id))
                pushWithFlash(router, '/backend/todos', t('example.todos.form.flash.deleted'), 'success')
              } catch (error) {
                const message =
                  error instanceof Error && error.message ? error.message : t('example.todos.table.error.delete')
                setErr(message)
              }
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
