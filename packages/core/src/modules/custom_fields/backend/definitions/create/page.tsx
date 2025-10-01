"use client"
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/custom_fields/data/validators'

const schema = upsertCustomEntitySchema

export default function CreateEntityPage() {
  const fields: CrudField[] = [
    { id: 'entityId', label: 'Entity ID', type: 'text', required: true, placeholder: 'module:entity' },
    { id: 'label', label: 'Label', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    { id: 'labelField', label: 'Default Label Field', type: 'text', placeholder: 'name' },
  ]

  return (
    <div className="p-6">
      <CrudForm
        title="New Custom Entity"
        schema={schema}
        fields={fields}
        initialValues={{ entityId: 'example:calendar_entity', label: 'Calendar Entity', labelField: 'name' }}
        submitLabel="Create"
        cancelHref="/backend/definitions"
        successRedirect="/backend/definitions"
        onSubmit={async (vals) => {
          const res = await apiFetch('/api/custom_fields/entities', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(vals),
          })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(j?.error || 'Failed to create')
          }
          flash('Entity created', 'success')
          // Redirect handled by successRedirect
        }}
      />
    </div>
  )
}
