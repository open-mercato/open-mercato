"use client"
import * as React from 'react'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

type TenantFormValues = {
  id: string
  name: string
  isActive: boolean
} & Record<string, unknown>

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'isActive'] },
  { id: 'custom', title: 'Custom Data', column: 2, kind: 'customFields' },
]

export default function EditTenantPage({ params }: { params?: { id?: string } }) {
  const tenantId = params?.id
  const [initial, setInitial] = React.useState<TenantFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!tenantId) return
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch(`/api/directory/tenants?id=${encodeURIComponent(tenantId)}`)
        if (!res.ok) await raiseCrudError(res, 'Failed to load tenant')
        const data = await res.json()
        const rows = Array.isArray(data?.items) ? data.items : []
        const row = rows[0]
        if (!row) throw new Error('Tenant not found')
        const cfValues: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          if (key.startsWith('cf_')) cfValues[key] = value
          else if (key.startsWith('cf:')) cfValues[`cf_${key.slice(3)}`] = value
        }
        const values: TenantFormValues = {
          id: String(row.id),
          name: String(row.name),
          isActive: !!row.isActive,
          ...cfValues,
        }
        if (!cancelled) setInitial(values)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load tenant'
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tenantId])

  if (!tenantId) return null

  if (error && !loading && !initial) {
    return (
      <Page>
        <PageBody>
          <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<TenantFormValues>
          title="Edit Tenant"
          backHref="/backend/directory/tenants"
          fields={fields}
          groups={groups}
          entityId={E.directory.tenant}
          initialValues={(initial || { id: tenantId, name: '', isActive: true }) as Partial<TenantFormValues>}
          isLoading={loading}
          loadingMessage="Loading tenant…"
          submitLabel="Save"
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
            const res = await apiFetch(`/api/directory/tenants?id=${encodeURIComponent(tenantId)}`, { method: 'DELETE' })
            if (!res.ok) {
              await raiseCrudError(res, 'Failed to delete tenant')
            }
          }}
          deleteRedirect="/backend/directory/tenants?flash=Tenant%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}
