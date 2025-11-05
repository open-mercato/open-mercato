"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { WidgetVisibilityEditor } from '@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'

type EditRoleFormValues = {
  name?: string
  tenantId?: string | null
} & Record<string, unknown>

type RoleRecord = {
  id: string
  name: string
  tenantId: string | null
  tenantName?: string | null
  usersCount?: number | null
} & Record<string, unknown>

export default function EditRolePage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const [initial, setInitial] = React.useState<RoleRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!id) return
    const roleId = id
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch(`/api/auth/roles?id=${encodeURIComponent(roleId)}`)
        const j = await res.json()
        const foundList = Array.isArray(j.items) ? j.items : []
        const found = (foundList[0] ?? null) as RoleRecord | null
        if (!cancelled) {
          setActorIsSuperAdmin(Boolean(j?.isSuperAdmin))
          setInitial(found || null)
          const tenant = found && typeof found.tenantId === 'string' ? found.tenantId : null
          setSelectedTenantId(tenant)
        }
      } catch {
        if (!cancelled) {
          setInitial(null)
          setSelectedTenantId(null)
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const preloadedTenants = React.useMemo(() => {
    if (!selectedTenantId) return null
    const name = initial?.tenantId === selectedTenantId
      ? (initial?.tenantName ?? selectedTenantId)
      : selectedTenantId
    return [{ id: selectedTenantId, name, isActive: true }]
  }, [initial, selectedTenantId])

  const fields = React.useMemo<CrudField[]>(() => {
    const disabled = !!(initial && typeof initial.usersCount === 'number' && initial.usersCount > 0)
    const list: CrudField[] = [
      {
        id: 'name',
        label: 'Name',
        type: 'text',
        required: true,
        disabled,
      },
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
            value={typeof value === 'string' ? value : value ?? selectedTenantId}
            onChange={(next) => {
              const resolved = next ?? null
              setValue(resolved)
              setSelectedTenantId(resolved)
              setAclData({ isSuperAdmin: false, features: [], organizations: null })
            }}
            includeEmptyOption
            className="w-full h-9 rounded border px-2 text-sm"
            tenants={preloadedTenants}
          />
        ),
      })
    }
    return list
  }, [actorIsSuperAdmin, initial, preloadedTenants, selectedTenantId])

  const detailFieldIds = React.useMemo(() => {
    const base = ['name']
    if (actorIsSuperAdmin) base.push('tenantId')
    return base
  }, [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => ([
    { id: 'details', title: 'Details', column: 1, fields: detailFieldIds },
    { id: 'customFields', title: 'Custom Fields', column: 2, kind: 'customFields' },
    {
      id: 'acl',
      title: 'Access',
      column: 1,
      component: () => (id
        ? (
          <AclEditor
            kind="role"
            targetId={String(id)}
            canEditOrganizations
            value={aclData}
            onChange={setAclData}
            currentUserIsSuperAdmin={actorIsSuperAdmin}
            tenantId={selectedTenantId ?? null}
          />
        )
        : null),
    },
    {
      id: 'dashboardWidgets',
      title: 'Dashboard Widgets',
      column: 2,
      component: () => (id && !loading
        ? (
          <WidgetVisibilityEditor
            kind="role"
            targetId={String(id)}
            tenantId={selectedTenantId ?? (initial?.tenantId ?? null)}
          />
        )
        : null),
    },
  ]), [aclData, actorIsSuperAdmin, detailFieldIds, id, initial, loading, selectedTenantId])

  if (!id) return null
  return (
    <Page>
      <PageBody>
        <CrudForm<EditRoleFormValues>
          title="Edit Role"
          backHref="/backend/roles"
          entityId={E.auth.role}
          fields={fields}
          groups={groups}
          initialValues={initial || { id, tenantId: null }}
          isLoading={loading}
          loadingMessage="Loading data..."
          submitLabel="Save"
          cancelHref="/backend/roles"
          successRedirect="/backend/roles?flash=Role%20saved&type=success"
          onSubmit={async (values) => {
            const customFields: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(values)) {
              if (key.startsWith('cf_')) customFields[key.slice(3)] = value
              else if (key.startsWith('cf:')) customFields[key.slice(3)] = value
            }
            const payload: Record<string, unknown> = { id }
            if (values.name !== undefined) payload.name = values.name
            let effectiveTenantId: string | null = selectedTenantId ?? (initial?.tenantId ?? null)
            if (actorIsSuperAdmin) {
              const rawTenant = typeof values.tenantId === 'string' ? values.tenantId.trim() : selectedTenantId
              effectiveTenantId = rawTenant && rawTenant.length ? rawTenant : null
              payload.tenantId = effectiveTenantId
            }
            if (Object.keys(customFields).length) {
              payload.customFields = customFields
            }
            await updateCrud('auth/roles', payload)
            const aclRes = await apiFetch('/api/auth/roles/acl', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ roleId: id, tenantId: effectiveTenantId, ...aclData }),
            })
            if (!aclRes.ok) {
              await raiseCrudError(aclRes, 'Failed to update role access control')
            }
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
          }}
          onDelete={async () => {
            const res = await apiFetch(`/api/auth/roles?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' })
            if (!res.ok) {
              await raiseCrudError(res, 'Failed to delete role')
            }
          }}
          deleteRedirect="/backend/roles?flash=Role%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}
