"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

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
        const body = { entityId, values }
        const res = await apiFetch('/api/entities/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        if (!res.ok) {
          let payload: any = null
          try { payload = await res.json() } catch {}
          if (payload?.fields) {
            const err: any = new Error(payload?.error || 'Validation failed')
            err.fieldErrors = payload.fields
            throw err
          }
          throw new Error(payload?.error || 'Failed to create')
        }
        router.push(`/backend/entities/user/${encodeURIComponent(entityId)}/records`)
      }}
    />
  )
}
