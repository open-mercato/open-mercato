"use client"
import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

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
      initialValues={initialValues || {}}
      isLoading={loading}
      loadingMessage="Loading record..."
      submitLabel="Save"
      cancelHref={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      successRedirect={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}
      onSubmit={async (values) => {
        const body = { entityId, recordId, values }
        const res = await apiFetch('/api/entities/records', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        if (!res.ok) throw new Error('Failed to save')
      }}
      onDelete={async () => {
        const res = await apiFetch(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed to delete')
        // navigate back
        if (typeof window !== 'undefined') window.location.href = `/backend/entities/user/${encodeURIComponent(entityId)}/records`
      }}
    />
  )
}
