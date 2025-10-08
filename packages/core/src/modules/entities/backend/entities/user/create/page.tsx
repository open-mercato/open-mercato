"use client"
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/entities/data/validators'
import { useRouter } from 'next/navigation'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'

const schema = upsertCustomEntitySchema

import { Page, PageBody } from '@open-mercato/ui/backend/Page'

export default function CreateEntityPage() {
  const router = useRouter()
  const fields: CrudField[] = [
    { id: 'entityId', label: 'Entity ID', type: 'text', required: true, placeholder: 'module_name:entity_id' },
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
    { id: 'showInSidebar', label: 'Show in sidebar', type: 'checkbox' } as CrudField,
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Entity"
          backHref="/backend/entities/user"
          schema={schema}
          fields={fields}
          initialValues={{ entityId: 'user:your_entity', label: '', showInSidebar: false }}
          submitLabel="Create"
          cancelHref="/backend/entities/user"
          onSubmit={async (vals) => {
            // Validate uniqueness client-side
            const listRes = await apiFetch('/api/entities/entities')
            const listJson = await listRes.json().catch(() => ({ items: [] }))
            const exists = Array.isArray(listJson?.items) && listJson.items.some((it: any) => it?.entityId === (vals as any).entityId && it?.source === 'custom')
            if (exists) throw new Error('Entity ID already exists')
            
            const res = await apiFetch('/api/entities/entities', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ 
                ...(vals as any), 
                labelField: 'name', 
                defaultEditor: (vals as any)?.defaultEditor || undefined,
              }),
            })
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j?.error || 'Failed to create')
            }
            // Trigger sidebar refresh
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
            const entityId = (vals as any).entityId as string
            pushWithFlash(router, `/backend/entities/user/${encodeURIComponent(entityId)}`, 'Entity created', 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}
