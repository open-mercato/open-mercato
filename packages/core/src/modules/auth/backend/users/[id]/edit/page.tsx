"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'

export default function EditUserPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const [initial, setInitial] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canEditOrgs, setCanEditOrgs] = React.useState(false)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })

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
      try {
        const res = await apiFetch(`/api/auth/users?id=${encodeURIComponent(String(id))}&page=1&pageSize=1`)
        const j = await res.json()
        const item = (j.items || [])[0]
        if (!cancelled) {
          if (!item) {
            setError('User not found')
            setInitial({})
          } else {
            setInitial({ ...item, roles: item.roles || [] })
          }
        }
      } catch (err) {
        console.error('Failed to load user:', err)
        if (!cancelled) setError('Failed to load user data')
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

  const selectedOrgId = initial?.organizationId ? String(initial.organizationId) : null

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
          value={typeof value === 'string' ? value : value ?? null}
          onChange={(next) => setValue(next ?? undefined)}
          required
          includeEmptyOption
          includeInactiveIds={selectedOrgId ? [selectedOrgId] : undefined}
        />
      ),
    },
    { id: 'roles', label: 'Roles', type: 'tags' },
  ]), [selectedOrgId])

  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['email', 'password', 'organizationId', 'roles'] },
    { id: 'acl', title: 'Access', column: 1, component: () => (id ? <AclEditor kind="user" targetId={String(id)} canEditOrganizations={canEditOrgs} value={aclData} onChange={setAclData} userRoles={initial?.roles || []} /> : null) },
  ]

  return (
    <Page>
      <PageBody>
        {error && (
          <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}
        <CrudForm
          title="Edit User"
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          initialValues={initial || {}}
          isLoading={loading}
          loadingMessage="Loading user data..."
          submitLabel="Save Changes"
          cancelHref="/backend/users"
          successRedirect="/backend/users?flash=User%20saved&type=success"
          onSubmit={async (vals: any) => { 
            await apiFetch('/api/auth/users', { 
              method: 'PUT', 
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...vals, id }) 
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
