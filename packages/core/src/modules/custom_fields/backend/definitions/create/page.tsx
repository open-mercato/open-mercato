"use client"
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/custom_fields/data/validators'

const schema = upsertCustomEntitySchema

import { Page, PageBody } from '@open-mercato/ui/backend/Page'

export default function CreateEntityPage() {
  const fields: CrudField[] = [
    { id: 'entityId', label: 'Entity ID', type: 'text', required: true, placeholder: 'module:entity' },
    { id: 'label', label: 'Label', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'defaultEditor',
      label: 'Default Editor (multiline)',
      type: 'select',
      options: [
        { value: '', label: 'Default (Markdown)' },
        { value: 'markdown', label: 'Markdown (UIW)' },
        { value: 'simpleMarkdown', label: 'Simple Markdown' },
        { value: 'htmlRichText', label: 'HTML Rich Text' },
      ],
    } as any,
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Entity"
          backHref="/backend/definitions"
          schema={schema}
          fields={fields}
          initialValues={{ entityId: 'example:calendar_entity', label: 'Calendar Entity' }}
          submitLabel="Create"
          cancelHref="/backend/definitions"
          successRedirect="/backend/definitions"
          onSubmit={async (vals) => {
            // Validate uniqueness client-side
            const listRes = await apiFetch('/api/custom_fields/entities')
            const listJson = await listRes.json().catch(() => ({ items: [] }))
            const exists = Array.isArray(listJson?.items) && listJson.items.some((it: any) => it?.entityId === (vals as any).entityId && it?.source === 'custom')
            if (exists) throw new Error('Entity ID already exists')
            const res = await apiFetch('/api/custom_fields/entities', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...(vals as any), labelField: 'name', defaultEditor: (vals as any)?.defaultEditor || undefined }),
            })
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j?.error || 'Failed to create')
            }
            flash('Entity created', 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}
