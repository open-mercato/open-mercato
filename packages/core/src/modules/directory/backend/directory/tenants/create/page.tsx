"use client"
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Tenant name' },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'isActive'] },
  { id: 'custom', title: 'Custom Data', column: 2, kind: 'customFields' },
]

async function ensureResponseOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return
  let message = fallback
  const contentType = res.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const data = await res.json()
      const extracted = data?.error || data?.message
      if (extracted && typeof extracted === 'string') message = extracted
    } else {
      const text = (await res.text()).trim()
      if (text) message = text
    }
  } catch {
    // ignore parsing failures, fall back to generic message
  }
  throw new Error(message)
}

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
            const res = await apiFetch('/api/directory/tenants', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            await ensureResponseOk(res, 'Failed to create tenant')
          }}
        />
      </PageBody>
    </Page>
  )
}
