"use client"
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Tenant name' },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'isActive'] },
  { id: 'custom', title: 'Custom Data', column: 2, kind: 'customFields' },
]

export default function CreateTenantPage() {
  return (
    <Page>
      <PageBody>
        <CrudForm<{
          name: string
          isActive: boolean
        } & Record<string, unknown>>
          title="Create Tenant"
          backHref="/backend/directory/tenants"
          fields={fields}
          groups={groups}
          entityId={E.directory.tenant}
          initialValues={{ name: '', isActive: true }}
          submitLabel="Create"
          cancelHref="/backend/directory/tenants"
          successRedirect="/backend/directory/tenants?flash=Tenant%20created&type=success"
          onSubmit={async (values) => {
            const customFields: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(values)) {
              if (key.startsWith('cf_')) customFields[key.slice(3)] = value
              else if (key.startsWith('cf:')) customFields[key.slice(3)] = value
            }
            const payload: {
              name: string
              isActive: boolean
              customFields?: Record<string, unknown>
            } = {
              name: values.name,
              isActive: values.isActive !== false,
            }
            if (Object.keys(customFields).length > 0) {
              payload.customFields = customFields
            }
            const res = await createCrud('directory/tenants', payload)
            await res.json().catch(() => null) // ignore body; createCrud returns response for consistency
          }}
        />
      </PageBody>
    </Page>
  )
}
