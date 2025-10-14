"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type FormValues = {
  name: string
  description: string | null
  organizationId: string | null
  expiresAt: string | null
  roles: string[]
}

export default function CreateApiKeyPage() {
  const [createdSecret, setCreatedSecret] = React.useState<{ secret: string; keyPrefix: string } | null>(null)

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea', description: 'Optional note to help teammates understand where this key is used.' },
    {
      id: 'organizationId',
      label: 'Organization',
      required: false,
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <OrganizationSelect
          id={id}
          value={typeof value === 'string' ? value : value ?? null}
          onChange={(next) => setValue(next ?? null)}
          includeEmptyOption
          placeholder="Inherit from selected scope"
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    { id: 'roles', label: 'Roles', type: 'tags', loadOptions: fetchRoleOptions, description: 'Requests authenticated with this key impersonate these roles.' },
    { id: 'expiresAt', label: 'Expires At', type: 'date', description: 'Leave empty for no expiration.' },
  ], [])

  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['name', 'description', 'organizationId', 'roles', 'expiresAt'] },
  ]

  return (
    <Page>
      <PageBody className="space-y-6">
        <CrudForm<FormValues>
          title="Create API Key"
          backHref="/backend/api-keys"
          fields={fields}
          groups={groups}
          initialValues={{ name: '', description: null, organizationId: null, roles: [], expiresAt: null }}
          submitLabel="Create"
          cancelHref="/backend/api-keys"
          onSubmit={async (values) => {
            const payload = {
              name: values.name,
              description: values.description || null,
              organizationId: values.organizationId || null,
              roles: Array.isArray(values.roles) ? values.roles : [],
              expiresAt: values.expiresAt || null,
            }
            const res = await apiFetch('/api/api-keys', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!res.ok) {
              let message = 'Failed to create API key'
              try {
                const data = await res.clone().json()
                if (data && typeof data.error === 'string') message = data.error
              } catch {}
              throw new Error(message)
            }
            const created = await res.json().catch(() => null)
            if (!created || typeof created.secret !== 'string') {
              throw new Error('API key created but secret was not returned')
            }
            setCreatedSecret({ secret: created.secret, keyPrefix: created.keyPrefix })
            flash('API key created. Copy the secret now — it will not be shown again.', 'success')
          }}
        />

        {createdSecret && (
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold leading-6">Copy your API key</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Store this secret securely. You will not be able to view it again once you leave this page.
              </p>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm break-all">
                {createdSecret.secret}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center rounded-full border px-2 py-1 font-medium">
                  Prefix: {createdSecret.keyPrefix}
                </span>
              </div>
            </div>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
