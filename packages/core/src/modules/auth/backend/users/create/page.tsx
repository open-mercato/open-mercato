"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { AclEditor } from '@open-mercato/core/modules/auth/backend/components/AclEditor'

export default function CreateUserPage() {
  const [orgOptions, setOrgOptions] = React.useState<{ value: string; label: string }[]>([])
  const [canEditOrgs, setCanEditOrgs] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
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
    }
    load()
    return () => { cancelled = true }
  }, [])

  const fields: CrudField[] = [
    { id: 'email', label: 'Email', type: 'text', required: true },
    { id: 'password', label: 'Password', type: 'text', required: true },
    { id: 'organizationId', label: 'Organization', type: 'select', required: true, options: orgOptions },
    { id: 'roles', label: 'Roles', type: 'tags' },
  ]

  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['email', 'password', 'organizationId', 'roles'] },
    { id: 'acl', title: 'Access', column: 2, component: () => (<div className="text-sm text-muted-foreground">ACL can be edited after creating the user.</div>) },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create User"
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          submitLabel="Create"
          cancelHref="/backend/users"
          successRedirect="/backend/users?flash=User%20created&type=success"
          onSubmit={async (vals: any) => { await apiFetch('/api/auth/users', { method: 'POST', body: JSON.stringify(vals) }) }}
        />
      </PageBody>
    </Page>
  )
}


