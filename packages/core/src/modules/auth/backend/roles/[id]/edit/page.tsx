"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { WidgetVisibilityEditor, type WidgetVisibilityEditorHandle } from '@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor'
import { E } from '#generated/entities.ids.generated'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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

type RoleListResponse = {
  items?: RoleRecord[]
  isSuperAdmin?: boolean
}

export default function EditRolePage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const [initial, setInitial] = React.useState<RoleRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null)
  const widgetEditorRef = React.useRef<WidgetVisibilityEditorHandle | null>(null)

  React.useEffect(() => {
    if (!id) return
    const roleId = id
    let cancelled = false
    async function load() {
      try {
        const { ok, result } = await apiCall<RoleListResponse>(`/api/auth/roles?id=${encodeURIComponent(roleId)}`)
        if (!ok) throw new Error(t('auth.roles.form.errors.load', 'Failed to load role'))
        const foundList = Array.isArray(result?.items) ? result?.items : []
        const found = (foundList?.[0] ?? null) as RoleRecord | null
        if (!cancelled) {
          setActorIsSuperAdmin(Boolean(result?.isSuperAdmin))
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
  }, [id, t])

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
        label: t('auth.roles.form.field.name', 'Name'),
        type: 'text',
        required: true,
        disabled,
      },
    ]
    if (actorIsSuperAdmin) {
      list.push({
        id: 'tenantId',
        label: t('auth.roles.form.field.tenant', 'Tenant'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => {
          const normalizedValue = typeof value === 'string'
            ? value
            : (typeof selectedTenantId === 'string' ? selectedTenantId : null)
          return (
            <TenantSelect
              id="tenantId"
              value={normalizedValue}
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
          )
        },
      })
    }
    return list
  }, [actorIsSuperAdmin, initial, preloadedTenants, selectedTenantId, t])

  const detailFieldIds = React.useMemo(() => {
    const base = ['name']
    if (actorIsSuperAdmin) base.push('tenantId')
    return base
  }, [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => ([
    { id: 'details', title: t('auth.roles.form.group.details', 'Details'), column: 1, fields: detailFieldIds },
    { id: 'customFields', title: t('entities.customFields.title', 'Custom Fields'), column: 2, kind: 'customFields' },
    {
      id: 'acl',
      title: t('auth.roles.form.group.access', 'Access'),
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
      title: t('auth.roles.form.group.widgets', 'Dashboard Widgets'),
      column: 2,
      component: () => (id && !loading
        ? (
          <WidgetVisibilityEditor
            kind="role"
            targetId={String(id)}
            tenantId={selectedTenantId ?? (initial?.tenantId ?? null)}
            ref={widgetEditorRef}
          />
        )
        : null),
    },
  ]), [aclData, actorIsSuperAdmin, detailFieldIds, id, initial, loading, selectedTenantId, t])

  if (!id) return null
  return (
    <Page>
      <PageBody>
        <CrudForm<EditRoleFormValues>
          title={t('auth.roles.form.title.edit', 'Edit Role')}
          backHref="/backend/roles"
          entityId={E.auth.role}
          fields={fields}
          groups={groups}
          initialValues={initial || { id, tenantId: null }}
          isLoading={loading}
          loadingMessage={t('auth.roles.form.loading', 'Loading data...')}
          cancelHref="/backend/roles"
          successRedirect={`/backend/roles?flash=${encodeURIComponent(t('auth.roles.flash.updated', 'Role saved'))}&type=success`}
          onSubmit={async (values) => {
            const customFields = collectCustomFieldValues(values)
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
            await updateCrud('auth/roles/acl', { roleId: id, tenantId: effectiveTenantId, ...aclData }, {
              errorMessage: t('auth.roles.form.errors.aclUpdate', 'Failed to update role access control'),
            })
            await widgetEditorRef.current?.save()
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
          }}
          onDelete={async () => {
            await deleteCrud('auth/roles', String(id), {
              errorMessage: t('auth.roles.form.errors.delete', 'Failed to delete role'),
            })
          }}
          deleteRedirect={`/backend/roles?flash=${encodeURIComponent(t('auth.roles.flash.deleted', 'Role deleted'))}&type=success`}
        />
      </PageBody>
    </Page>
  )
}
