"use client"
import * as React from 'react'
import { useT } from '@/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

type UpdateRecordRequest = (payload: { entityId: string; recordId: string; values: Record<string, unknown> }) => Promise<void>

async function defaultUpdateRecordRequest(payload: { entityId: string; recordId: string; values: Record<string, unknown> }) {
  await updateCrud('entities/records', payload)
}

export async function submitCustomEntityRecordUpdate(options: {
  entityId: string
  recordId: string
  values: Record<string, unknown>
  updateRecord?: UpdateRecordRequest
  messages?: {
    entityIdRequired?: string
    recordIdRequired?: string
  }
}) {
  const { entityId, recordId, values, updateRecord = defaultUpdateRecordRequest, messages } = options
  if (!entityId || !entityId.trim()) {
    const message = messages?.entityIdRequired ?? 'Entity identifier is required'
    throw createCrudFormError(message, { entityId: message })
  }
  if (!recordId || !recordId.trim()) {
    const message = messages?.recordIdRequired ?? 'Record identifier is required'
    throw createCrudFormError(message, { recordId: message })
  }
  await updateRecord({ entityId, recordId, values })
}

type RecordsResponse = { items: any[] }

export default function EditRecordPage({ params }: { params: { entityId?: string; recordId?: string } }) {
  const t = useT()
  const entityId = decodeURIComponent(params?.entityId || '')
  const recordId = decodeURIComponent(params?.recordId || '')

  const [initialValues, setInitialValues] = React.useState<Record<string, any> | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=1&sortField=id&sortDir=asc&id=${encodeURIComponent(recordId)}`)
        const j: RecordsResponse = await res.json().catch(() => ({ items: [] }))
        const item = (j.items || []).find((x: any) => String(x.id) === String(recordId)) || null
        if (!cancelled) setInitialValues(item || {})
      } catch {
        if (!cancelled) setInitialValues({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (entityId && recordId) load()
    return () => { cancelled = true }
  }, [entityId, recordId])

  const schema = React.useMemo(() => z.object({}).passthrough(), [])

  const fields: CrudField[] = []

  return (
    <CrudForm
      title={t('entities.userEntities.records.form.editTitle', 'Edit record')}
      backHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      schema={schema}
      fields={fields}
      entityId={entityId}
      customEntity
      initialValues={initialValues || {}}
      isLoading={loading}
      loadingMessage={t('entities.userEntities.records.loading', 'Loading record...')}
      submitLabel={t('entities.userEntities.records.form.submitSave', 'Save')}
      cancelHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      successRedirect={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      onSubmit={async (values) => {
        await submitCustomEntityRecordUpdate({
          entityId,
          recordId,
          values: values as Record<string, unknown>,
          messages: {
            entityIdRequired: t('entities.userEntities.records.errors.entityIdRequired', 'Entity identifier is required'),
            recordIdRequired: t('entities.userEntities.records.errors.recordIdRequired', 'Record identifier is required'),
          },
        })
      }}
      onDelete={async () => {
        const res = await apiFetch(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`, { method: 'DELETE' })
        if (!res.ok) {
          await raiseCrudError(res, t('entities.userEntities.records.errors.deleteFailed', 'Failed to delete record'))
        }
        // navigate back
        if (typeof window !== 'undefined') window.location.href = `/backend/entities/user/${encodeURIComponent(entityId)}/records`
      }}
    />
  )
}
