"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

export default function CreateRolePage() {
  const fields: CrudField[] = [
    { id: 'name', label: 'Name', type: 'text', required: true },
  ]
  const groups: CrudFormGroup[] = [
    { id: 'details', title: 'Details', column: 1, fields: ['name'] },
    { id: 'customFields', title: 'Custom Fields', column: 2, kind: 'customFields' },
  ]
  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Role"
          backHref="/backend/roles"
          entityId={E.auth.role}
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

