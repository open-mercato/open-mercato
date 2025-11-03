"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'

type CreateRoleFormValues = {
  name: string
  tenantId: string | null
} & Record<string, unknown>

export default function CreateRolePage() {
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadActor() {
      try {
        const res = await apiFetch('/api/auth/roles?page=1&pageSize=1')
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (!cancelled) setActorIsSuperAdmin(Boolean(data?.isSuperAdmin))
      } catch {
        if (!cancelled) setActorIsSuperAdmin(false)
      }
    }
    loadActor()
    return () => { cancelled = true }
  }, [])

  const fields = React.useMemo<CrudField[]>(() => {
    const list: CrudField[] = [
      { id: 'name', label: 'Name', type: 'text', required: true },
    ]
    if (actorIsSuperAdmin) {
      list.push({
        id: 'tenantId',
        label: 'Tenant',
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => (
          <TenantSelect
            id="tenantId"
            value={typeof value === 'string' ? value : null}
            onChange={(next) => {
              setValue(next ?? null)
            }}
            includeEmptyOption
            required
            className="w-full h-9 rounded border px-2 text-sm"
          />
        ),
      })
    }
    return list
  }, [actorIsSuperAdmin])

  const detailFieldIds = React.useMemo(() => {
    const base = ['name']
    if (actorIsSuperAdmin) base.push('tenantId')
    return base
  }, [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => ([
    { id: 'details', title: 'Details', column: 1, fields: detailFieldIds },
    { id: 'customFields', title: 'Custom Fields', column: 2, kind: 'customFields' },
  ]), [detailFieldIds])

  const initialValues = React.useMemo<Partial<CreateRoleFormValues>>(
    () => ({
      name: '',
      tenantId: null,
    }),
    [],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<CreateRoleFormValues>
          title="Create Role"
          backHref="/backend/roles"
          entityId={E.auth.role}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel="Create"
          cancelHref="/backend/roles"
          successRedirect="/backend/roles?flash=Role%20created&type=success"
          onSubmit={async (values) => {
            const customFields: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(values)) {
              if (key.startsWith('cf_')) customFields[key.slice(3)] = value
              else if (key.startsWith('cf:')) customFields[key.slice(3)] = value
            }
            const payload: Record<string, unknown> = {
              name: values.name,
            }
            if (actorIsSuperAdmin) {
              const rawTenant = typeof values.tenantId === 'string' ? values.tenantId.trim() : null
              payload.tenantId = rawTenant && rawTenant.length ? rawTenant : null
            }
            if (Object.keys(customFields).length) {
              payload.customFields = customFields
            }
            await apiFetch('/api/auth/roles', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
