"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormValues = {
  name: string
  description?: string | null
  sourceType: 'interview' | 'trace_mining' | 'hybrid'
  status: 'draft' | 'validated' | 'active' | 'deprecated'
  frameworkJson: string
}

type Response = {
  items?: Array<Record<string, unknown>>
}

function mapInitial(item: Record<string, unknown> | null): FormValues {
  const statusRaw = typeof item?.status === 'string' ? item.status : 'draft'
  const sourceRaw =
    (typeof item?.source_type === 'string' ? item.source_type : null) ??
    (typeof item?.sourceType === 'string' ? item.sourceType : null) ??
    'hybrid'

  const framework =
    (item?.framework_json && typeof item.framework_json === 'object' ? item.framework_json : null) ??
    (item?.frameworkJson && typeof item.frameworkJson === 'object' ? item.frameworkJson : null)

  return {
    name: typeof item?.name === 'string' ? item.name : '',
    description: typeof item?.description === 'string' ? item.description : '',
    sourceType: sourceRaw === 'interview' || sourceRaw === 'trace_mining' ? sourceRaw : 'hybrid',
    status: statusRaw === 'validated' || statusRaw === 'active' || statusRaw === 'deprecated' ? statusRaw : 'draft',
    frameworkJson: framework ? JSON.stringify(framework, null, 2) : '',
  }
}

function parseFrameworkJson(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Framework JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}

export default function EditSkillPage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const t = useT()
  const id = params?.id

  const [initialValues, setInitialValues] = React.useState<FormValues>(mapInitial(null))
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const response = await apiCall<Response>(`/api/agent_governance/skills?id=${encodeURIComponent(id)}`)
        const item = Array.isArray(response.result?.items) ? response.result.items[0] : null
        if (!cancelled) {
          setInitialValues(mapInitial(item ?? null))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [id])

  if (!id) return null

  const fields: CrudField[] = [
    { id: 'name', label: t('agent_governance.skills.fields.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('agent_governance.skills.fields.description', 'Description'), type: 'textarea' },
    {
      id: 'sourceType',
      label: t('agent_governance.skills.fields.sourceType', 'Source type'),
      type: 'select',
      required: true,
      options: [
        { value: 'interview', label: t('agent_governance.skills.source.interview', 'Interview') },
        { value: 'trace_mining', label: t('agent_governance.skills.source.traceMining', 'Trace mining') },
        { value: 'hybrid', label: t('agent_governance.skills.source.hybrid', 'Hybrid') },
      ],
    },
    {
      id: 'status',
      label: t('agent_governance.skills.fields.status', 'Status'),
      type: 'select',
      required: true,
      options: [
        { value: 'draft', label: t('agent_governance.skills.status.draft', 'Draft') },
        { value: 'validated', label: t('agent_governance.skills.status.validated', 'Validated') },
        { value: 'active', label: t('agent_governance.skills.status.active', 'Active') },
        { value: 'deprecated', label: t('agent_governance.skills.status.deprecated', 'Deprecated') },
      ],
    },
    { id: 'frameworkJson', label: t('agent_governance.skills.fields.frameworkJson', 'Framework JSON'), type: 'textarea' },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('agent_governance.skills.editTitle', 'Edit Skill')}
          backHref="/backend/agent-governance/skills"
          fields={fields}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('agent_governance.skills.loading', 'Loading skill...')}
          onSubmit={async (values) => {
            let frameworkJson: Record<string, unknown> | null = null
            try {
              frameworkJson = parseFrameworkJson(values.frameworkJson)
            } catch {
              const message = t('agent_governance.skills.errors.invalidJson', 'Framework JSON is invalid.')
              throw createCrudFormError(message, { frameworkJson: message })
            }

            await updateCrud('agent_governance/skills', {
              id,
              name: values.name,
              description: values.description ?? null,
              sourceType: values.sourceType,
              status: values.status,
              frameworkJson,
            })
            router.push('/backend/agent-governance/skills')
            router.refresh()
          }}
          onDelete={async () => {
            await deleteCrud('agent_governance/skills', id)
          }}
          deleteRedirect="/backend/agent-governance/skills"
        />
      </PageBody>
    </Page>
  )
}
