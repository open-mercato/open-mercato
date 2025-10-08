"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Tenant name' },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'isActive'] },
]

export default function CreateTenantPage() {
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Tenant"
          backHref="/backend/directory/tenants"
          fields={fields}
          groups={groups}
          initialValues={{ name: '', isActive: true }}
          submitLabel="Create"
          cancelHref="/backend/directory/tenants"
          successRedirect="/backend/directory/tenants?flash=Tenant%20created&type=success"
          onSubmit={async (values) => {
            await apiFetch('/api/directory/tenants', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
