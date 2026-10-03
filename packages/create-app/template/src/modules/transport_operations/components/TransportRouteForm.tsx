"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RouteRow } from './TransportRoutesTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'transport_operations:transport_route'
const LIST_HREF = '/backend/transport/routes'
const RESOURCE = 'transport_operations/routes'

export type RouteFormValues = {
  id: string
  code: string
  name: string
  startLocation: string
  endLocation: string
  estimatedDurationMinutes: number
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

export function toRouteFormValues(row: RouteRow): RouteFormValues {
  return {
    id: row.id,
    code: row.code ?? '',
    name: row.name ?? '',
    startLocation: row.start_location ?? '',
    endLocation: row.end_location ?? '',
    estimatedDurationMinutes: Number(row.estimated_duration_minutes ?? 0),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildRouteFormDefaults(id = ''): RouteFormValues {
  return {
    id,
    code: '',
    name: '',
    startLocation: '',
    endLocation: '',
    estimatedDurationMinutes: 30,
    updatedAt: null,
  }
}

export function toRoutePayload(values: RouteFormValues): Record<string, unknown> {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    startLocation: values.startLocation.trim(),
    endLocation: values.endLocation.trim(),
    estimatedDurationMinutes: Number.isFinite(values.estimatedDurationMinutes)
      ? values.estimatedDurationMinutes
      : undefined,
  }
}

type Translate = ReturnType<typeof useT>

function useRouteFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'code', label: t('transport_operations.routes.form.fields.code', 'Code'), type: 'text', required: true, layout: 'half' },
    { id: 'name', label: t('transport_operations.routes.form.fields.name', 'Route name'), type: 'text', required: true, layout: 'half' },
    { id: 'startLocation', label: t('transport_operations.routes.form.fields.startLocation', 'Starting point'), type: 'text', required: true, layout: 'half' },
    { id: 'endLocation', label: t('transport_operations.routes.form.fields.endLocation', 'Destination'), type: 'text', required: true, layout: 'half' },
    { id: 'estimatedDurationMinutes', label: t('transport_operations.routes.form.fields.duration', 'Estimated duration (minutes)'), type: 'number', required: true, layout: 'half' },
  ], [t])
}

function useRouteGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identification',
      title: t('transport_operations.routes.form.groups.identification', 'Identification'),
      column: 1,
      fields: ['code', 'name', 'estimatedDurationMinutes'],
    },
    {
      id: 'path',
      title: t('transport_operations.routes.form.groups.path', 'Path'),
      column: 2,
      fields: ['startLocation', 'endLocation'],
    },
  ], [t])
}

export function RouteCreateForm() {
  const t = useT()
  const fields = useRouteFields(t)
  const groups = useRouteGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.routes.form.flash.saved', 'Route saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<RouteFormValues>
      title={t('transport_operations.routes.form.create.title', 'New route')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildRouteFormDefaults()}
      submitLabel={t('transport_operations.routes.form.create.submit', 'Create route')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toRoutePayload(values))
      }}
    />
  )
}

export function RouteEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useRouteFields(t)
  const groups = useRouteGroups(t)
  const [initial, setInitial] = React.useState<RouteFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<RouteRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toRouteFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('transport_operations.routes.form.error.load', 'Could not load the route.'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.routes.form.flash.saved', 'Route saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.routes.form.flash.deleted', 'Route deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('transport_operations.routes.form.error.notFound', 'Route not found.')}
        backHref={LIST_HREF}
        backLabel={t('transport_operations.routes.actions.backToList', 'Back to routes')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<RouteFormValues>
      title={t('transport_operations.routes.form.edit.title', 'Edit route')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildRouteFormDefaults(id)}
      submitLabel={t('transport_operations.routes.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('transport_operations.routes.form.loading', 'Loading route…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toRoutePayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
