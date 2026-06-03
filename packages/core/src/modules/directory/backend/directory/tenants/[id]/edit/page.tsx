"use client"
import * as React from 'react'
import { E } from '#generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { readApiResultOrThrow, apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'

type TenantFormValues = {
  id: string
  name: string
  isActive: boolean
  updatedAt?: string | null
} & Record<string, unknown>

export default function EditTenantPage({ params }: { params?: { id?: string } }) {
  const tenantId = params?.id
  const [initial, setInitial] = React.useState<TenantFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const t = useT()
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('directory.tenants.form.fields.name', 'Name'), type: 'text', required: true },
    { id: 'isActive', label: t('directory.tenants.form.fields.active', 'Active'), type: 'checkbox' },
  ], [t])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', title: t('directory.tenants.form.groups.details', 'Details'), column: 1, fields: ['name', 'isActive'] },
    { id: 'custom', title: t('directory.tenants.form.groups.custom', 'Custom Data'), column: 2, kind: 'customFields' },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!tenantId) return
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const data = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
          `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`,
          undefined,
          { errorMessage: t('directory.tenants.form.errors.load', 'Failed to load tenant'), fallback: { items: [] } },
        )
        const rows = Array.isArray(data?.items) ? data.items : []
        const row = rows[0]
        if (!row) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const cfValues = extractCustomFieldEntries(row as Record<string, unknown>)
        const values: TenantFormValues = {
          id: String(row.id),
          name: String(row.name),
          isActive: !!row.isActive,
          updatedAt: typeof row.updatedAt === 'string'
            ? row.updatedAt
            : typeof row.updated_at === 'string'
              ? row.updated_at
              : null,
          ...cfValues,
        }
        if (!cancelled) setInitial(values)
      } catch (err) {
        if (!cancelled) {
          if ((err as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            const message = err instanceof Error ? err.message : t('directory.tenants.form.errors.load', 'Failed to load tenant')
            setError(message)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tenantId, t])

  if (!tenantId) return null

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('directory.tenants.form.errors.notFound', 'Tenant not found')}
            backHref="/backend/directory/tenants"
            backLabel={t('directory.tenants.form.actions.backToList', 'Back to tenants')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !loading && !initial) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<TenantFormValues>
          title={t('directory.tenants.form.title.edit', 'Edit Tenant')}
          backHref="/backend/directory/tenants"
          versionHistory={{ resourceKind: 'directory.tenant', resourceId: tenantId ? String(tenantId) : '' }}
          fields={fields}
          groups={groups}
          entityId={E.directory.tenant}
          initialValues={(initial || { id: tenantId, name: '', isActive: true }) as Partial<TenantFormValues>}
          optimisticLockUpdatedAt={initial?.updatedAt}
          isLoading={loading}
          loadingMessage={t('directory.tenants.form.loading', 'Loading tenant…')}
          submitLabel={t('common.save', 'Save')}
          cancelHref="/backend/directory/tenants"
          successRedirect="/backend/directory/tenants?flash=Tenant%20updated&type=success"
          onSubmit={async (values) => {
            const customFields = collectCustomFieldValues(values)
            const payload: {
              id: string
              name: string
              isActive: boolean
              customFields?: Record<string, unknown>
            } = {
              id: values.id || tenantId,
              name: values.name,
              isActive: values.isActive !== false,
            }
            if (Object.keys(customFields).length > 0) {
              payload.customFields = customFields
            }
            await updateCrud('directory/tenants', payload)
          }}
          onDelete={async () => {
            const headers = buildOptimisticLockHeader(initial?.updatedAt)
            const call = await withScopedApiRequestHeaders(headers, () => (
              apiCall(
                `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`,
                { method: 'DELETE' },
              )
            ))
            if (!call.ok) {
              await raiseCrudError(call.response, t('directory.tenants.form.errors.delete', 'Failed to delete tenant'))
            }
          }}
          deleteRedirect="/backend/directory/tenants?flash=Tenant%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}
