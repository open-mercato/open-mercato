"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

export default function CreateRolePage() {
  const fields: CrudField[] = [
    { id: 'name', label: 'Name', type: 'text', required: true },
  ]
  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['name'] },
  ]
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Role"
          backHref="/backend/roles"
          fields={fields}
          groups={groups}
          submitLabel="Create"
          cancelHref="/backend/roles"
          successRedirect="/backend/roles?flash=Role%20created&type=success"
          onSubmit={async (vals: any) => { await apiFetch('/api/auth/roles', { method: 'POST', body: JSON.stringify(vals) }) }}
        />
      </PageBody>
    </Page>
  )
}


