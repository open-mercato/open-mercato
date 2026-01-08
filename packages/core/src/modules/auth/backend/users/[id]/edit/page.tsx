"use client"
import * as React from 'react'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'
import { WidgetVisibilityEditor } from '@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type EditUserFormValues = {
  email: string
  password: string
  tenantId: string | null
  organizationId: string | null
  roles: string[]
} & Record<string, unknown>

type LoadedUser = {
  id: string
  email: string
  organizationId: string | null
  tenantId: string | null
  tenantName: string | null
  organizationName: string | null
  roles: string[]
}

type UserApiItem = {
  id?: string | null
  email?: string | null
  organizationId?: string | null
  tenantId?: string | null
  tenantName?: string | null
  organizationName?: string | null
  roles?: unknown
}

type UserListResponse = {
  items?: UserApiItem[]
  isSuperAdmin?: boolean
}

type FeatureCheckResponse = {
  ok?: boolean
}

type TenantAwareOrganizationSelectProps = {
  fieldId: string
  value: string | null
  setValue: (value: string | null) => void
  tenantId: string | null
  includeInactiveIds?: Iterable<string | null | undefined>
}

function TenantAwareOrganizationSelectInput({
  fieldId,
  value,
  setValue,
  tenantId,
  includeInactiveIds,
}: TenantAwareOrganizationSelectProps) {
  const prevTenantRef = React.useRef<string | null>(tenantId)
  const hydratedRef = React.useRef(false)
  const handleChange = React.useCallback((next: string | null) => {
    setValue(next ?? null)
  }, [setValue])

  React.useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      prevTenantRef.current = tenantId
      return
    }
    if (prevTenantRef.current !== tenantId) {
      prevTenantRef.current = tenantId
      setValue(null)
    }
  }, [tenantId, setValue])

  return (
    <OrganizationSelect
      id={fieldId}
      value={value}
      onChange={handleChange}
      required
      includeEmptyOption
      className="w-full h-9 rounded border px-2 text-sm"
      includeInactiveIds={includeInactiveIds}
      tenantId={tenantId}
    />
  )
}

export default function EditUserPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const [initialUser, setInitialUser] = React.useState<LoadedUser | null>(null)
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canEditOrgs, setCanEditOrgs] = React.useState(false)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })
  const [customFieldValues, setCustomFieldValues] = React.useState<Record<string, unknown>>({})
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)

  React.useEffect(() => {
    if (!id) {
      setLoading(false)
      setError(t('auth.users.form.errors.noId', 'No user ID provided'))
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setCustomFieldValues({})
      try {
        const { ok, result } = await apiCall<UserListResponse>(
          `/api/auth/users?id=${encodeURIComponent(String(id))}&page=1&pageSize=1`,
        )
        if (!ok) throw new Error('load_failed')
        const item = Array.isArray(result?.items) ? result?.items?.[0] : undefined
        if (!cancelled) {
          setActorIsSuperAdmin(Boolean(result?.isSuperAdmin))
          if (!item) {
            setError(t('auth.users.form.errors.notFound', 'User not found'))
            setCustomFieldValues({})
            setInitialUser(null)
            setSelectedTenantId(null)
          } else {
            setInitialUser({
              id: item.id ? String(item.id) : String(id),
              email: item.email ? String(item.email) : '',
              organizationId: item.organizationId ? String(item.organizationId) : null,
              tenantId: item.tenantId ? String(item.tenantId) : null,
              tenantName: item.tenantName ? String(item.tenantName) : null,
              organizationName: item.organizationName ? String(item.organizationName) : null,
              roles: Array.isArray(item.roles)
                ? item.roles
                    .map((role) => (typeof role === 'string' ? role : role == null ? '' : String(role)))
                    .filter((role) => role.trim().length > 0)
                : [],
            })
            setSelectedTenantId(item.tenantId ? String(item.tenantId) : null)
            const custom: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(item)) {
              if (key.startsWith('cf_')) custom[key] = value as unknown
              else if (key.startsWith('cf:')) custom[`cf_${key.slice(3)}`] = value as unknown
            }
            setCustomFieldValues(custom)
          }
        }
      } catch (err) {
        console.error('Failed to load user:', err)
        if (!cancelled) setError(t('auth.users.form.errors.load', 'Failed to load user data'))
        if (!cancelled) setCustomFieldValues({})
      }
      try {
        const featureCheck = await apiCall<FeatureCheckResponse>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: ['directory.organizations.view'] }),
          },
          { fallback: { ok: false } },
        )
        if (!cancelled) setCanEditOrgs(Boolean(featureCheck.result?.ok))
      } catch (err) {
        console.error('Failed to check features:', err)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const selectedOrgId = initialUser?.organizationId ? String(initialUser.organizationId) : null
  const preloadedTenants = React.useMemo(() => {
    if (!selectedTenantId) return null
    const name = initialUser?.tenantId === selectedTenantId
      ? (initialUser?.tenantName ?? selectedTenantId)
      : selectedTenantId
    return [{ id: selectedTenantId, name, isActive: true }]
  }, [initialUser, selectedTenantId])

  const loadRoleOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    if (actorIsSuperAdmin) {
      if (!selectedTenantId) return []
      return fetchRoleOptions(query, { tenantId: selectedTenantId })
    }
    return fetchRoleOptions(query)
  }, [actorIsSuperAdmin, selectedTenantId])

  const fields: CrudField[] = React.useMemo(() => {
    const items: CrudField[] = [
      { id: 'email', label: t('auth.users.form.field.email', 'Email'), type: 'text', required: true },
      { id: 'password', label: t('auth.users.form.field.password', 'Password'), type: 'text' },
    ]
    if (actorIsSuperAdmin) {
      items.push({
        id: 'tenantId',
        label: t('auth.users.form.field.tenant', 'Tenant'),
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
              required
              tenants={preloadedTenants}
            />
          )
        },
      })
    }
    items.push({
      id: 'organizationId',
      label: t('auth.users.form.field.organization', 'Organization'),
      type: 'custom',
      component: ({ id, value, setValue }) => {
        const normalizedValue = typeof value === 'string' ? (value.length > 0 ? value : null) : null
        return (
          <TenantAwareOrganizationSelectInput
            fieldId={id}
            value={normalizedValue}
            setValue={(next) => setValue(next ?? null)}
            tenantId={selectedTenantId}
            includeInactiveIds={selectedOrgId ? [selectedOrgId] : undefined}
          />
        )
      },
    })
    items.push({ id: 'roles', label: t('auth.users.form.field.roles', 'Roles'), type: 'tags', loadOptions: loadRoleOptions })
    return items
  }, [actorIsSuperAdmin, loadRoleOptions, preloadedTenants, selectedOrgId, selectedTenantId, t])

  const detailFieldIds = React.useMemo(() => {
    const base: string[] = ['email', 'password', 'organizationId', 'roles']
    if (actorIsSuperAdmin) base.splice(2, 0, 'tenantId')
    return base
  }, [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => [
    { id: 'details', title: t('auth.users.form.group.details', 'Details'), column: 1, fields: detailFieldIds },
    { id: 'custom', title: t('auth.users.form.group.customFields', 'Custom Data'), column: 2, kind: 'customFields' },
    {
      id: 'acl',
      title: t('auth.users.form.group.access', 'Access'),
      column: 1,
      component: () => (id
        ? (
          <AclEditor
            kind="user"
            targetId={String(id)}
            canEditOrganizations={canEditOrgs}
            value={aclData}
            onChange={setAclData}
            userRoles={initialUser?.roles || []}
            currentUserIsSuperAdmin={actorIsSuperAdmin}
            tenantId={selectedTenantId ?? null}
          />
        )
        : null),
    },
    {
      id: 'dashboardWidgets',
      title: t('auth.users.form.group.widgets', 'Dashboard Widgets'),
      column: 2,
      component: () => (id && initialUser
        ? (
          <WidgetVisibilityEditor
            kind="user"
            targetId={String(id)}
            tenantId={selectedTenantId ?? null}
            organizationId={initialUser?.organizationId ?? null}
          />
        ) : null
      ),
    },
  ], [aclData, actorIsSuperAdmin, canEditOrgs, detailFieldIds, id, initialUser, selectedTenantId, t])

  const initialValues = React.useMemo(() => {
    if (initialUser) {
      return {
        email: initialUser.email,
        password: '',
        tenantId: initialUser.tenantId,
        organizationId: initialUser.organizationId,
        roles: initialUser.roles,
        ...customFieldValues,
      }
    }
    return {
      email: '',
      password: '',
      tenantId: selectedTenantId ?? null,
      organizationId: null,
      roles: [],
      ...customFieldValues,
    }
  }, [initialUser, customFieldValues, selectedTenantId])

  return (
    <Page>
      <PageBody>
        {error && (
          <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}
        <CrudForm<EditUserFormValues>
          title={t('auth.users.form.title.edit', 'Edit User')}
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          entityId={E.auth.user}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('auth.users.form.loading', 'Loading user data...')}
          submitLabel={t('auth.users.form.action.save', 'Save')}
          cancelHref="/backend/users"
          successRedirect={`/backend/users?flash=${encodeURIComponent(t('auth.users.flash.updated', 'User saved'))}&type=success`}
          onSubmit={async (values) => {
            if (!id) return
            const customFields = collectCustomFieldValues(values)
            const payload = {
              id: id ? String(id) : '',
              email: values.email,
              password: values.password && values.password.trim() ? values.password : undefined,
              organizationId: values.organizationId ? values.organizationId : undefined,
              roles: Array.isArray(values.roles) ? values.roles : [],
              ...(Object.keys(customFields).length ? { customFields } : {}),
            }
            await updateCrud('auth/users', payload)
            await updateCrud('auth/users/acl', { userId: id, ...aclData }, {
              errorMessage: t('auth.users.form.errors.aclUpdate', 'Failed to update user access control'),
            })
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
          }}
          onDelete={async () => {
            await deleteCrud('auth/users', String(id), {
              errorMessage: t('auth.users.form.errors.delete', 'Failed to delete user'),
            })
          }}
          deleteRedirect={`/backend/users?flash=${encodeURIComponent(t('auth.users.flash.deleted', 'User deleted'))}&type=success`}
        />
      </PageBody>
    </Page>
  )
}
