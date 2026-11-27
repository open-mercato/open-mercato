'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readRequestOrganizationScope } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { isRecord } from '@open-mercato/shared/lib/utils'
import { CrudForm, type CrudFormSubmitContext } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { detailsSection, statusSection, titleSection } from '../todo-showcase-sections.client'
import { readTodoShowcase, showcaseSinks, todoShowcaseMutationEndpoint, todoShowcaseHref } from '../lib/todoShowcaseClient'
import { toTodoFormValues } from './TodoForm'

const baseSections = [titleSection, detailsSection, statusSection] as const
const definitionSets = { 'example.todo-showcase-fields': ['example:todo'] }
const responseSchema = z.object({ id: z.uuid().optional(), extensionWarnings: z.array(z.object({ code: z.string() })).optional() })

function attachExtensionVersions(
  payload: NonNullable<CrudFormSubmitContext['sectionPayload']>,
  loaded: unknown,
): Record<string, unknown> {
  if (!isRecord(payload.extensions) || !isRecord(payload.extensions.example) || !loaded) return payload
  const fields = payload.extensions.example
  const written = showcaseSinks().filter(({ payloadPaths }) => payloadPaths.some((path) =>
    Object.hasOwn(fields, path.slice('extensions.example.'.length))))
  const version = typeof loaded === 'string' && written.length === 1 ? loaded
    : isRecord(loaded) ? Object.fromEntries(written.flatMap(({ id }) =>
      typeof loaded[id] === 'string' ? [[id, loaded[id]]] : [])) : undefined
  if (!version || (typeof version !== 'string' && !Object.keys(version).length)) return payload
  return { ...payload, extensions: { ...payload.extensions, example: { ...fields, __updatedAt: version } } }
}

export function TodoShowcaseForm({ id }: { id?: string }) {
  const t = useT()
  const [item, setItem] = useState<Awaited<ReturnType<typeof readTodoShowcase>>>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void readTodoShowcase(id).then((value) => {
      if (!cancelled) setItem(value)
    }).catch((error: { status?: number }) => {
      if (!cancelled && error?.status !== 404) setFailed(true)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, reload])

  if (loading) return <LoadingMessage label={t('example.todos.form.loading')} />
  if (failed) return <ErrorMessage label={t('example.todos.form.error.load')} />
  if (id && !item) return <RecordNotFoundState label={t('example.todos.form.error.notFound')} backHref="/backend/todos" />

  const extensions = item?._extensions?.example
  const values = item ? toTodoFormValues(item) : { is_done: false, cf_priority: 3, cf_severity: 'medium' }
  const operation = id ? 'update' : 'create'
  return (
    <CrudForm
      title={t(id ? 'example.todoShowcase.edit' : 'example.todoShowcase.create')}
      titleHeadingLevel={1}
      entityId="example:todo"
      formVariant="showcase"
      formOperation={operation}
      resourceId={id}
      backHref="/backend/todos"
      cancelHref="/backend/todos"
      fields={baseSections.flatMap(({ fields }) => fields)}
      groups={baseSections.map(({ group, fields }) => ({ ...group, fields: fields.map(({ id: fieldId }) => fieldId) }))}
      sectionDescriptors={baseSections}
      sectionCustomFieldDefinitionSets={definitionSets}
      initialValues={{
        ...values,
        brand: extensions?.brand,
        erpSupplierRef: extensions?.erpSupplierRef,
        erpCostCenter: extensions?.erpCostCenter,
        showcaseSync: extensions?.__sync,
      }}
      successRedirect={id ? undefined : (_values, result) => result?.resourceId ? `${todoShowcaseHref}/${result.resourceId}` : '/backend/todos'}
      deleteRedirect="/backend/todos"
      onSubmit={async (_values, context) => {
        if (!id && readRequestOrganizationScope()?.organizationId === null) {
          throw createCrudFormError(t('example.todos.form.error.organizationRequired'))
        }
        if (!context?.mutation || !context.sectionPayload) throw new Error('[internal] Todo showcase requires an accepted section mutation')
        const payload = attachExtensionVersions(context.sectionPayload, extensions?.__updatedAt)
        const result = await context.mutation.write(todoShowcaseMutationEndpoint, id ? { ...payload, id } : payload)
        if (!result.ok) await raiseCrudError(result.response)
        const parsed = responseSchema.safeParse(result.result)
        if (parsed.success && parsed.data.extensionWarnings?.length) {
          flash(t('example.todoShowcase.warnings.observer'), 'warning')
        } else {
          flash(t(id ? 'example.todos.form.flash.saved' : 'example.todos.form.flash.created'), 'success')
        }
        if (id) {
          setLoading(true)
          setReload((previous) => previous + 1)
        }
        return { resourceId: id ?? parsed.data?.id }
      }}
      onDelete={id ? async (context) => {
        if (!context?.mutation) throw new Error('[internal] Todo showcase requires an accepted section delete')
        const result = await context.mutation.write(todoShowcaseMutationEndpoint, { id })
        if (!result.ok) await raiseCrudError(result.response)
      } : undefined}
    />
  )
}
