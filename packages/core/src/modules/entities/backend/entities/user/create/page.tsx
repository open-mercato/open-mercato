"use client"
import * as React from 'react'
import { z } from 'zod'
import { useT } from '@/lib/i18n/context'
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
  const t = useT()
  const router = useRouter()
  const fields = React.useMemo<CrudField[]>(() => ([
    {
      id: 'entityId',
      label: t('entities.userEntities.form.entityId.label', 'Entity ID'),
      type: 'text',
      required: true,
      placeholder: t('entities.userEntities.form.entityId.placeholder', 'module_name:entity_id'),
    },
    { id: 'label', label: t('entities.userEntities.form.label.label', 'Label'), type: 'text', required: true },
    { id: 'description', label: t('entities.userEntities.form.description.label', 'Description'), type: 'textarea' },
    {
      id: 'defaultEditor',
      label: t('entities.userEntities.form.defaultEditor.label', 'Default Editor (multiline)'),
      type: 'select',
      options: [
        { value: '', label: t('entities.userEntities.form.defaultEditor.options.default', 'Default (Markdown)') },
        { value: 'markdown', label: t('entities.userEntities.form.defaultEditor.options.markdown', 'Markdown (UIW)') },
        { value: 'simpleMarkdown', label: t('entities.userEntities.form.defaultEditor.options.simpleMarkdown', 'Simple Markdown') },
        { value: 'htmlRichText', label: t('entities.userEntities.form.defaultEditor.options.htmlRichText', 'HTML Rich Text') },
      ],
    } as unknown as CrudField,
    { id: 'showInSidebar', label: t('entities.userEntities.form.showInSidebar.label', 'Show in sidebar'), type: 'checkbox' } as CrudField,
  ]), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('entities.userEntities.form.title', 'Create Entity')}
          backHref="/backend/entities/user"
          schema={schema}
          fields={fields}
          initialValues={{ entityId: 'user:your_entity', label: '', showInSidebar: false }}
          submitLabel={t('entities.userEntities.form.submit', 'Create')}
          cancelHref="/backend/entities/user"
          onSubmit={async (vals) => {
            const entityId = await submitCreateEntity({
              values: vals as Record<string, unknown>,
              messages: {
                entityIdRequired: t('entities.userEntities.errors.entityIdRequired', 'Entity ID is required'),
                entityIdExists: t('entities.userEntities.errors.entityIdExists', 'Entity ID already exists'),
                loadFailed: t('entities.userEntities.errors.loadFailed', 'Failed to load entities'),
              },
            })
            try {
              window.dispatchEvent(new Event('om:refresh-sidebar'))
            } catch {}
            const successMessage = t('entities.userEntities.flash.created', 'Entity created')
            pushWithFlash(router, `/backend/entities/user/${encodeURIComponent(entityId)}`, successMessage, 'success')
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

type FetchCustomEntities = (errorMessage?: string) => Promise<EntityListEntry[]>

async function defaultFetchCustomEntities(errorMessage?: string): Promise<EntityListEntry[]> {
  const res = await apiFetch('/api/entities/entities')
  if (!res.ok) {
    await raiseCrudError(res, errorMessage ?? 'Failed to load entities')
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
  messages?: {
    entityIdRequired?: string
    entityIdExists?: string
    loadFailed?: string
  }
}): Promise<string> {
  const {
    values,
    fetchEntities = defaultFetchCustomEntities,
    createEntity = defaultCreateEntityRequest,
    messages,
  } = options
  const rawEntityId = typeof values.entityId === 'string' ? values.entityId.trim() : ''
  if (!rawEntityId) {
    const message = messages?.entityIdRequired ?? 'Entity ID is required'
    throw createCrudFormError(message, { entityId: message })
  }

  const existing = await fetchEntities(messages?.loadFailed)
  const exists = existing.some(
    (entry) => entry?.entityId === rawEntityId && (entry?.source === 'custom' || entry?.source === undefined),
  )
  if (exists) {
    const message = messages?.entityIdExists ?? 'Entity ID already exists'
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
