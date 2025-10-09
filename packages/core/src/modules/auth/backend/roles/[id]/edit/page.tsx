"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

export default function EditRolePage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const [initial, setInitial] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })

  React.useEffect(() => {
    if (!id) return
    const roleId = id
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch(`/api/auth/roles?id=${encodeURIComponent(roleId)}`)
        const j = await res.json()
        const found = (j.items || [])[0]
        if (!cancelled) setInitial(found || null)
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const fields: CrudField[] = [
    { id: 'name', label: 'Name', type: 'text', required: true },
  ]
  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['name'] },
    { id: 'customFields', title: 'Custom Fields', column: 2, kind: 'customFields' },
    { id: 'acl', title: 'Access', column: 1, component: () => (id ? <AclEditor kind="role" targetId={String(id)} canEditOrganizations={true} value={aclData} onChange={setAclData} /> : null) },
  ]

  if (!id) return null
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Edit Role"
          backHref="/backend/roles"
          entityId={E.auth.role}
          fields={fields}
          groups={groups}
          initialValues={initial || { id }}
          isLoading={loading}
          loadingMessage="Loading data..."
          submitLabel="Save Changes"
          cancelHref="/backend/roles"
          successRedirect="/backend/roles?flash=Role%20saved&type=success"
          onSubmit={async (vals: any) => { 
            await apiFetch('/api/auth/roles', { 
              method: 'PUT', 
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...vals, id }) 
            })
            // Save ACL data
            await apiFetch('/api/auth/roles/acl', { 
              method: 'PUT', 
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ roleId: id, ...aclData }) 
            })
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
          }}
          onDelete={async () => { 
            const res = await apiFetch(`/api/auth/roles?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' })
            if (!res.ok) {
              let message = 'Failed to delete role'
              try {
                const data = await res.clone().json()
                if (data && typeof data.error === 'string' && data.error.trim()) message = data.error
              } catch {
                try {
                  const text = await res.text()
                  if (text.trim()) message = text
                } catch {}
              }
              throw new Error(message)
            }
          }}
          deleteRedirect="/backend/roles?flash=Role%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}
