"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

type CreateRecordRequest = (payload: { entityId: string; values: Record<string, unknown> }) => Promise<void>

async function defaultCreateRecordRequest(payload: { entityId: string; values: Record<string, unknown> }) {
  await createCrud('entities/records', payload)
}

export async function submitCustomEntityRecord(options: {
  entityId: string
  values: Record<string, unknown>
  createRecord?: CreateRecordRequest
}) {
  const { entityId, values, createRecord = defaultCreateRecordRequest } = options
  if (!entityId || !entityId.trim()) {
    throw createCrudFormError('Entity identifier is required', { entityId: 'Entity identifier is required' })
  }
  await createRecord({ entityId, values })
}

export default function CreateRecordPage({ params }: { params: { entityId?: string } }) {
  const router = useRouter()
  const entityId = decodeURIComponent(params?.entityId || '')

  const schema = React.useMemo(() => z.object({
    // Dynamic: all fields are optional; keep unknown keys
  }).passthrough(), [])

  const fields: CrudField[] = []

  return (
    <CrudForm
      title={`Create record`}
      backHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      schema={schema}
      fields={fields}
      entityId={entityId}
      customEntity
      submitLabel="Create"
      cancelHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      successRedirect={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      onSubmit={async (values) => {
        await submitCustomEntityRecord({ entityId, values: values as Record<string, unknown> })
        router.push(`/backend/entities/user/${encodeURIComponent(entityId)}/records`)
      }}
    />
  )
}
