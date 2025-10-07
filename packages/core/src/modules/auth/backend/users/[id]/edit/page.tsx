"use client"
import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { AclEditor } from '@open-mercato/core/modules/auth/components/AclEditor'

export default function EditUserPage() {
  const params = useParams<{ id: string }>()
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id
  const [initial, setInitial] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [orgOptions, setOrgOptions] = React.useState<{ value: string; label: string }[]>([])
  const [canEditOrgs, setCanEditOrgs] = React.useState(false)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch(`/api/auth/users?id=${encodeURIComponent(String(id))}&page=1&pageSize=1`)
        const j = await res.json()
        const item = (j.items || [])[0]
        if (!cancelled) setInitial(item ? { ...item, roles: item.roles || [] } : null)
      } catch {}
      try {
        const f = await apiFetch('/api/auth/feature-check', { method: 'POST', body: JSON.stringify({ features: ['directory.organizations.list'] }) })
        const j = await f.json()
        if (!cancelled) setCanEditOrgs(!!j.ok)
      } catch {}
      try {
        const res = await apiFetch('/api/directory/organizations')
        const j = await res.json()
        if (!cancelled) setOrgOptions((j.items || []).map((o: any) => ({ value: o.id, label: o.name })))
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const fields: CrudField[] = [
    { id: 'email', label: 'Email', type: 'text', required: true },
    { id: 'password', label: 'Password', type: 'text' },
    { id: 'organizationId', label: 'Organization', type: 'select', required: true, options: orgOptions },
    { id: 'roles', label: 'Roles', type: 'tags' },
  ]

  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['email', 'password', 'organizationId', 'roles'] },
    { id: 'acl', title: 'Access', column: 2, component: () => (id ? <AclEditor kind="user" targetId={String(id)} canEditOrganizations={canEditOrgs} /> : null) },
  ]

  if (!id) return null

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Edit User"
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          initialValues={initial || { id }}
          isLoading={loading}
          loadingMessage="Loading data..."
          submitLabel="Save Changes"
          cancelHref="/backend/users"
          successRedirect="/backend/users?flash=User%20saved&type=success"
          onSubmit={async (vals: any) => { await apiFetch('/api/auth/users', { method: 'PUT', body: JSON.stringify({ ...vals, id }) }) }}
          onDelete={async () => { await apiFetch(`/api/auth/users?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' }) }}
          deleteRedirect="/backend/users?flash=User%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}


