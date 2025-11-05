"use client"
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, readJsonSafe, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
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
            const entityId = await submitCreateEntity({
              values: vals as Record<string, unknown>,
            })
            try {
              window.dispatchEvent(new Event('om:refresh-sidebar'))
            } catch {}
            pushWithFlash(router, `/backend/entities/user/${encodeURIComponent(entityId)}`, 'Entity created', 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}

type EntityListEntry = {
  entityId?: string
  source?: string
}

type FetchCustomEntities = () => Promise<EntityListEntry[]>

async function defaultFetchCustomEntities(): Promise<EntityListEntry[]> {
  const res = await apiFetch('/api/entities/entities')
  if (!res.ok) {
    await raiseCrudError(res, 'Failed to load entities')
  }
  const data = await readJsonSafe<{ items?: EntityListEntry[] }>(res)
  return Array.isArray(data?.items) ? data!.items! : []
}

type CreateEntityRequest = (payload: Record<string, unknown>) => Promise<void>

async function defaultCreateEntityRequest(payload: Record<string, unknown>) {
  await createCrud('entities/entities', payload)
}

export async function submitCreateEntity(options: {
  values: Record<string, unknown>
  fetchEntities?: FetchCustomEntities
  createEntity?: CreateEntityRequest
}): Promise<string> {
  const { values, fetchEntities = defaultFetchCustomEntities, createEntity = defaultCreateEntityRequest } = options
  const rawEntityId = typeof values.entityId === 'string' ? values.entityId.trim() : ''
  if (!rawEntityId) {
    throw createCrudFormError('Entity ID is required', { entityId: 'Entity ID is required' })
  }

  const existing = await fetchEntities()
  const exists = existing.some(
    (entry) => entry?.entityId === rawEntityId && (entry?.source === 'custom' || entry?.source === undefined),
  )
  if (exists) {
    const message = 'Entity ID already exists'
    throw createCrudFormError(message, { entityId: message })
  }

  const payload: Record<string, unknown> = {
    ...values,
    entityId: rawEntityId,
    labelField: 'name',
    defaultEditor:
      typeof (values as Record<string, unknown>).defaultEditor === 'string' &&
      (values as Record<string, unknown>).defaultEditor
        ? (values as Record<string, unknown>).defaultEditor
        : undefined,
  }

  await createEntity(payload)
  return rawEntityId
}
