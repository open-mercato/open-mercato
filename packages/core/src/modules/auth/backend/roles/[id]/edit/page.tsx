"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { AclEditor } from '@open-mercato/core/modules/auth/components/AclEditor'

export default function EditRolePage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const [initial, setInitial] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch(`/api/auth/roles?page=1&pageSize=1&search=`)
        const j = await res.json()
        const found = (j.items || []).find((r: any) => String(r.id) === String(id))
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
    { id: 'acl', title: 'Access', column: 2, component: () => (id ? <AclEditor kind="role" targetId={String(id)} canEditOrganizations={true} /> : null) },
  ]

  if (!id) return null
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Edit Role"
          backHref="/backend/roles"
          fields={fields}
          groups={groups}
          initialValues={initial || { id }}
          isLoading={loading}
          loadingMessage="Loading data..."
          submitLabel="Save Changes"
          cancelHref="/backend/roles"
          successRedirect="/backend/roles?flash=Role%20saved&type=success"
          onSubmit={async (vals: any) => { await apiFetch('/api/auth/roles', { method: 'PUT', body: JSON.stringify({ ...vals, id }) }) }}
          onDelete={async () => { await apiFetch(`/api/auth/roles?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' }) }}
          deleteRedirect="/backend/roles?flash=Role%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}


