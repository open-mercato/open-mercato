"use client"
import * as React from 'react'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'
import { WidgetVisibilityEditor } from '@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor'

type EditUserFormValues = {
  email: string
  password: string
  organizationId: string | null
  roles: string[]
} & Record<string, unknown>

type LoadedUser = {
  id: string
  email: string
  organizationId: string | null
  tenantId: string | null
  organizationName: string | null
  roles: string[]
}

type UserApiItem = {
  id?: string | null
  email?: string | null
  organizationId?: string | null
  tenantId?: string | null
  organizationName?: string | null
  roles?: unknown
}

type UserListResponse = {
  items?: UserApiItem[]
}

export default function EditUserPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const [initialUser, setInitialUser] = React.useState<LoadedUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canEditOrgs, setCanEditOrgs] = React.useState(false)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })
  const [customFieldValues, setCustomFieldValues] = React.useState<Record<string, unknown>>({})

  React.useEffect(() => {
    if (!id) {
      setLoading(false)
      setError('No user ID provided')
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setCustomFieldValues({})
      try {
        const res = await apiFetch(`/api/auth/users?id=${encodeURIComponent(String(id))}&page=1&pageSize=1`)
        const payload: UserListResponse = await res.json().catch(() => ({}))
        const item = Array.isArray(payload.items) ? payload.items[0] : undefined
        if (!cancelled) {
          if (!item) {
            setError('User not found')
            setCustomFieldValues({})
            setInitialUser(null)
          } else {
            setInitialUser({
              id: item.id ? String(item.id) : String(id),
              email: item.email ? String(item.email) : '',
              organizationId: item.organizationId ? String(item.organizationId) : null,
              tenantId: item.tenantId ? String(item.tenantId) : null,
              organizationName: item.organizationName ? String(item.organizationName) : null,
              roles: Array.isArray(item.roles)
                ? item.roles
                    .map((role) => (typeof role === 'string' ? role : role == null ? '' : String(role)))
                    .filter((role) => role.trim().length > 0)
                : [],
            })
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
        if (!cancelled) setError('Failed to load user data')
        if (!cancelled) setCustomFieldValues({})
      }
      try {
        const f = await apiFetch('/api/auth/feature-check', { 
          method: 'POST', 
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['directory.organizations.view'] }) 
        })
        const j = await f.json()
        if (!cancelled) setCanEditOrgs(!!j.ok)
      } catch (err) {
        console.error('Failed to check features:', err)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const selectedOrgId = initialUser?.organizationId ? String(initialUser.organizationId) : null

  const fields: CrudField[] = React.useMemo(() => ([
    { id: 'email', label: 'Email', type: 'text', required: true },
    { id: 'password', label: 'Password', type: 'text' },
    {
      id: 'organizationId',
      label: 'Organization',
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <OrganizationSelect
          id={id}
          value={typeof value === 'string' ? (value.length > 0 ? value : null) : (value ?? null)}
          onChange={(next) => setValue(next ?? null)}
          required
          includeEmptyOption
          className="w-full h-9 rounded border px-2 text-sm"
          includeInactiveIds={selectedOrgId ? [selectedOrgId] : undefined}
        />
      ),
    },
    { id: 'roles', label: 'Roles', type: 'tags', loadOptions: fetchRoleOptions },
  ]), [selectedOrgId])

  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['email', 'password', 'organizationId', 'roles'] },
    { id: 'custom', title: 'Custom Data', column: 2, kind: 'customFields' },
    { id: 'acl', title: 'Access', column: 1, component: () => (id ? <AclEditor kind="user" targetId={String(id)} canEditOrganizations={canEditOrgs} value={aclData} onChange={setAclData} userRoles={initialUser?.roles || []} /> : null) },
    {
      id: 'dashboardWidgets',
      title: 'Dashboard Widgets',
      column: 2,
      component: () => (id && initialUser
        ? (
          <WidgetVisibilityEditor
            kind="user"
            targetId={String(id)}
            tenantId={initialUser?.tenantId ?? null}
            organizationId={initialUser?.organizationId ?? null}
          />
        ) : null
      ),
    },
  ]

  const initialValues = React.useMemo(() => {
    if (initialUser) {
      return {
        email: initialUser.email,
        password: '',
        organizationId: initialUser.organizationId,
        roles: initialUser.roles,
        ...customFieldValues,
      }
    }
    return {
      email: '',
      password: '',
      organizationId: null,
      roles: [],
      ...customFieldValues,
    }
  }, [initialUser, customFieldValues])

  return (
    <Page>
      <PageBody>
        {error && (
          <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}
        <CrudForm<EditUserFormValues>
          title="Edit User"
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          entityId={E.auth.user}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage="Loading user data..."
          submitLabel="Save"
          cancelHref="/backend/users"
          successRedirect="/backend/users?flash=User%20saved&type=success"
          onSubmit={async (values) => {
            if (!id) return
            const customFields: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(values)) {
              if (key.startsWith('cf_')) customFields[key.slice(3)] = value
              else if (key.startsWith('cf:')) customFields[key.slice(3)] = value
            }
            const payload = {
              id: id ? String(id) : '',
              email: values.email,
              password: values.password && values.password.trim() ? values.password : undefined,
              organizationId: values.organizationId ? values.organizationId : undefined,
              roles: Array.isArray(values.roles) ? values.roles : [],
              ...(Object.keys(customFields).length ? { customFields } : {}),
            }
            await apiFetch('/api/auth/users', { 
              method: 'PUT', 
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload), 
            })
            // Save ACL data
            await apiFetch('/api/auth/users/acl', { 
              method: 'PUT', 
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ userId: id, ...aclData }) 
            })
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
          }}
          onDelete={async () => { await apiFetch(`/api/auth/users?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' }) }}
          deleteRedirect="/backend/users?flash=User%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}
