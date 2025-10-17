"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@/lib/i18n/context'

export default function CreateTodoPage() {
  const t = useT()
  const fields = React.useMemo<CrudField[]>(() => [
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
      id: 'tips',
      title: t('example.todos.form.groups.tips'),
      column: 2,
      component: () => (
        <div className="text-sm text-muted-foreground">
          {t('example.todos.form.groups.tips.body')}
        </div>
      ),
    },
  ], [t])
  const successRedirect = React.useMemo(
    () => `/backend/todos?flash=${encodeURIComponent(t('example.todos.form.flash.created'))}&type=success`,
    [t],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('example.todos.form.create.title')}
          backHref="/backend/todos"
          entityId="example:todo"
          fields={fields}
          groups={groups}
          submitLabel={t('example.todos.form.create.submit')}
          cancelHref="/backend/todos"
          successRedirect={successRedirect}
          onSubmit={async (vals) => { await createCrud('example/todos', vals) }}
        />
      </PageBody>
    </Page>
  )
}
