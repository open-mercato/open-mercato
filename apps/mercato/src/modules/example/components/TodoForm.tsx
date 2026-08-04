"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import type { TodoListItem } from '../types'

const ENTITY_ID = 'example:todo'
const LIST_HREF = '/backend/todos'

type Translate = ReturnType<typeof useT>

type TodoCustomFieldValues = Record<`cf_${string}`, unknown>

export type TodoFormValues = {
  id: string
  title: string
  is_done: boolean
  // Carries the optimistic-lock version into `CrudForm`, which auto-derives the
  // expected-version header from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
} & TodoCustomFieldValues

function useTodoFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
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
}

function useTodoGroups(t: Translate, extraGroup: CrudFormGroup): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', title: t('example.todos.form.groups.details'), column: 1, fields: ['title'] },
    { id: 'status', title: t('example.todos.form.groups.status'), column: 2, fields: ['is_done', 'cf_blocked'] },
    { id: 'attributes', title: t('example.todos.form.groups.attributes'), column: 1, kind: 'customFields' },
    extraGroup,
  ], [t, extraGroup])
}

export function TodoCreateForm() {
  const t = useT()
  const fields = useTodoFields(t)
  const tipsGroup = React.useMemo<CrudFormGroup>(() => ({
    id: 'tips',
    title: t('example.todos.form.groups.tips'),
    column: 2,
    component: () => (
      <div className="text-sm text-muted-foreground">
        {t('example.todos.form.groups.tips.body')}
      </div>
    ),
  }), [t])
  const groups = useTodoGroups(t, tipsGroup)
  const successRedirect = React.useMemo(
    () => `${LIST_HREF}?flash=${encodeURIComponent(t('example.todos.form.flash.created'))}&type=success`,
    [t],
  )

  return (
    <CrudForm
      title={t('example.todos.form.create.title')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      submitLabel={t('example.todos.form.create.submit')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (vals) => { await createCrud('example/todos', vals) }}
    />
  )
}

export function TodoEditForm({ id }: { id: string }) {
  const t = useT()
  const router = useRouter()
  const [initial, setInitial] = React.useState<TodoFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const fields = useTodoFields(t)
  const actionsGroup = React.useMemo<CrudFormGroup>(() => ({
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
  }), [t])
  const groups = useTodoGroups(t, actionsGroup)
  const successRedirect = React.useMemo(
    () => `${LIST_HREF}?flash=${encodeURIComponent(t('example.todos.form.flash.saved'))}&type=success`,
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      setIsNotFound(false)
      try {
        const data = await fetchCrudList<TodoListItem>('example/todos', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        // Map to form initial values
        const extended = item as TodoListItem & Record<string, unknown>
        const cfInit = extractCustomFieldEntries(extended) as Partial<TodoCustomFieldValues>
        const init: TodoFormValues = {
          id: item.id,
          title: item.title,
          is_done: Boolean(item.is_done),
          updatedAt: item.updatedAt ?? null,
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
    id,
    title: '',
    is_done: false,
    updatedAt: null,
  }), [id])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('example.todos.form.error.notFound')}
        backHref={LIST_HREF}
        backLabel={t('example.todos.form.actions.backToList', 'Back to todos')}
      />
    )
  }

  if (err) return <ErrorMessage label={err} />

  return (
    <CrudForm<TodoFormValues>
      title={t('example.todos.form.edit.title')}
      backHref={LIST_HREF}
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
          viewHref={`${LIST_HREF}/${id}/edit`}
        />
      )}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('example.todos.form.edit.submit')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('example.todos.form.loading')}
      onSubmit={async (vals) => { await updateCrud('example/todos', vals) }}
      onDelete={async () => {
        try {
          await deleteCrud('example/todos', String(id))
          pushWithFlash(router, LIST_HREF, t('example.todos.form.flash.deleted'), 'success')
        } catch (error) {
          // `CrudForm` scopes the expected-version header around `onDelete`, so a
          // stale version comes back as a 409 here rather than reaching the form's
          // own handler. Route it to the shared conflict bar first.
          if (surfaceRecordConflict(error, t)) return
          const message =
            error instanceof Error && error.message ? error.message : t('example.todos.table.error.delete')
          setErr(message)
        }
      }}
    />
  )
}
