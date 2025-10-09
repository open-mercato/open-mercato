"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'

type CreateUserFormValues = {
  email: string
  password: string
  organizationId: string | null
  roles: string[]
}

export default function CreateUserPage() {
  const fields: CrudField[] = React.useMemo(() => ([
    { id: 'email', label: 'Email', type: 'text', required: true },
    { id: 'password', label: 'Password', type: 'text', required: true },
    {
      id: 'organizationId',
      label: 'Organization',
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <OrganizationSelect
          id={id}
          value={typeof value === 'string' ? value : value ?? null}
          onChange={(next) => setValue(next ?? null)}
          required
          includeEmptyOption
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    { id: 'roles', label: 'Roles', type: 'tags' },
  ]), [])

  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['email', 'password', 'organizationId', 'roles'] },
    { id: 'acl', title: 'Access', column: 2, component: () => (<div className="text-sm text-muted-foreground">ACL can be edited after creating the user.</div>) },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm<CreateUserFormValues>
          title="Create User"
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          initialValues={{ email: '', password: '', organizationId: null, roles: [] }}
          submitLabel="Create"
          cancelHref="/backend/users"
          successRedirect="/backend/users?flash=User%20created&type=success"
          onSubmit={async (values) => {
            const payload = {
              email: values.email,
              password: values.password,
              organizationId: values.organizationId ? values.organizationId : null,
              roles: Array.isArray(values.roles) ? values.roles : [],
            }
            await apiFetch('/api/auth/users', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
