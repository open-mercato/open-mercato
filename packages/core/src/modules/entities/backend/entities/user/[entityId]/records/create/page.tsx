"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

type CreateRecordRequest = (payload: { entityId: string; values: Record<string, unknown> }) => Promise<void>

const defaultCreateRecordRequest: CreateRecordRequest = async (payload) => {
  await createCrud('entities/records', payload)
}

export async function submitCustomEntityRecord(options: {
  entityId: string
  values: Record<string, unknown>
  createRecord?: CreateRecordRequest
  messages?: {
    entityIdRequired?: string
  }
}) {
  const { entityId, values, createRecord = defaultCreateRecordRequest, messages } = options
  if (!entityId || !entityId.trim()) {
    const message = messages?.entityIdRequired ?? 'Entity identifier is required'
    throw createCrudFormError(message, { entityId: message })
  }
  await createRecord({ entityId, values })
}

export default function CreateRecordPage({ params }: { params: { entityId?: string } }) {
  const t = useT()
  const router = useRouter()
  const entityId = decodeURIComponent(params?.entityId || '')

  const schema = React.useMemo(() => z.object({
    // Dynamic: all fields are optional; keep unknown keys
  }).passthrough(), [])

  const fields: CrudField[] = []

  return (
    <CrudForm
      title={t('entities.userEntities.records.form.createTitle', 'Create record')}
      backHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      schema={schema}
      fields={fields}
      entityId={entityId}
      customEntity
      submitLabel={t('entities.userEntities.records.form.submitCreate', 'Create')}
      cancelHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      successRedirect={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      onSubmit={async (values) => {
        await submitCustomEntityRecord({
          entityId,
          values: values as Record<string, unknown>,
          messages: {
            entityIdRequired: t('entities.userEntities.records.errors.entityIdRequired', 'Entity identifier is required'),
          },
        })
        router.push(`/backend/entities/user/${encodeURIComponent(entityId)}/records`)
      }}
    />
  )
}
