"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import type { TodoListItem } from '../../../../types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'

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
  const [isNotFound, setIsNotFound] = React.useState(false)
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
    { id: 'cf_blocked', label: t('example.todos.table.column.blocked'), type: 'checkbox' },
  ], [t])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', title: t('example.todos.form.groups.details'), column: 1, fields: ['title'] },
    { id: 'status', title: t('example.todos.form.groups.status'), column: 2, fields: ['is_done', 'cf_blocked'] },
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
      setIsNotFound(false)
      try {
        const data = await fetchCrudList<TodoItem>('example/todos', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        // Map to form initial values
        const extended = item as TodoItem & Record<string, unknown>
        const cfInit = extractCustomFieldEntries(extended) as Partial<TodoCustomFieldValues>
        const init: TodoFormValues = {
          id: item.id,
          title: item.title,
          is_done: Boolean(item.is_done),
          ...(cfInit as TodoCustomFieldValues),
          cf_priority: extended.cf_priority ?? cfInit.cf_priority,
          cf_severity: extended.cf_severity ?? cfInit.cf_severity,
          cf_blocked: extended.cf_blocked ?? cfInit.cf_blocked,
          cf_labels: extended.cf_labels ?? cfInit.cf_labels,
          cf_assignee: extended.cf_assignee ?? cfInit.cf_assignee,
          cf_description: extended.cf_description ?? cfInit.cf_description,
        }
        if (!cancelled) setInitial(init)
      } catch (error: unknown) {
        if (!cancelled) {
          if ((error as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            const message = error instanceof Error && error.message ? error.message : t('example.todos.form.error.load')
            setErr(message)
          }
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

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('example.todos.form.error.notFound')}
            backHref="/backend/todos"
            backLabel={t('example.todos.form.actions.backToList', 'Back to todos')}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {err ? (
          <ErrorMessage label={err} />
        ) : (
          <CrudForm<TodoFormValues>
            title={t('example.todos.form.edit.title')}
            backHref="/backend/todos"
            extraActions={(
              <SendObjectMessageDialog
                object={{
                  entityModule: 'example',
                  entityType: 'todo',
                  entityId: id,
                  previewData: {
                    title: (initial?.title && initial.title.trim().length > 0) ? initial.title : fallbackInitialValues.title,
                    metadata: {
                      [t('example.todos.form.fields.isDone.label')]: (initial?.is_done ?? false)
                        ? t('common.yes', 'Yes')
                        : t('common.no', 'No'),
                    },
                  },
                }}
                viewHref={`/backend/todos/${id}/edit`}
              />
            )}
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
