"use client"
import { E } from '#generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
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
            const customFields = collectCustomFieldValues(values)
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
            await createCrud('directory/tenants', payload)
          }}
        />
      </PageBody>
    </Page>
  )
}
