"use client"
import * as React from 'react'
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
}) {
  const { entityId, recordId, values, updateRecord = defaultUpdateRecordRequest } = options
  if (!entityId || !entityId.trim()) {
    throw createCrudFormError('Entity identifier is required', { entityId: 'Entity identifier is required' })
  }
  if (!recordId || !recordId.trim()) {
    throw createCrudFormError('Record identifier is required', { recordId: 'Record identifier is required' })
  }
  await updateRecord({ entityId, recordId, values })
}

type RecordsResponse = { items: any[] }

export default function EditRecordPage({ params }: { params: { entityId?: string; recordId?: string } }) {
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
      title={`Edit record`}
      backHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      schema={schema}
      fields={fields}
      entityId={entityId}
      customEntity
      initialValues={initialValues || {}}
      isLoading={loading}
      loadingMessage="Loading record..."
      submitLabel="Save"
      cancelHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      successRedirect={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      onSubmit={async (values) => {
        await submitCustomEntityRecordUpdate({ entityId, recordId, values: values as Record<string, unknown> })
      }}
      onDelete={async () => {
        const res = await apiFetch(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`, { method: 'DELETE' })
        if (!res.ok) {
          await raiseCrudError(res, 'Failed to delete record')
        }
        // navigate back
        if (typeof window !== 'undefined') window.location.href = `/backend/entities/user/${encodeURIComponent(entityId)}/records`
      }}
    />
  )
}
