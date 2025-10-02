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
    // Dynamic: all fields are optional; validation is mainly UI-level
  }), [])

  const fields: CrudField[] = []

  return (
    <CrudForm
      title={`Create record`}
      backHref={`/backend/user-entities/${encodeURIComponent(entityId)}/records`}
      schema={schema}
      fields={fields}
      entityId={entityId}
      submitLabel="Create"
      cancelHref={`/backend/user-entities/${encodeURIComponent(entityId)}/records`}
      successRedirect={`/backend/user-entities/${encodeURIComponent(entityId)}/records`}
      onSubmit={async (values) => {
        const body = { entityId, values }
        const res = await apiFetch('/api/custom_fields/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        if (!res.ok) throw new Error('Failed to create')
        router.push(`/backend/user-entities/${encodeURIComponent(entityId)}/records`)
      }}
    />
  )
}


