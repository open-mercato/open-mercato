"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormValues = {
  name: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  description?: string | null
  minScore: number
  maxScore: number
  requiresApproval: boolean
  failClosed: boolean
  isDefault: boolean
}

type Response = {
  items?: Array<Record<string, unknown>>
}

function mapInitial(item: Record<string, unknown> | null): FormValues {
  const levelRaw =
    (typeof item?.risk_level === 'string' ? item.risk_level : null) ??
    (typeof item?.riskLevel === 'string' ? item.riskLevel : null)

  return {
    name: typeof item?.name === 'string' ? item.name : '',
    riskLevel: levelRaw === 'medium' || levelRaw === 'high' || levelRaw === 'critical' ? levelRaw : 'low',
    description: typeof item?.description === 'string' ? item.description : '',
    minScore:
      (typeof item?.min_score === 'number' ? item.min_score : null) ??
      (typeof item?.minScore === 'number' ? item.minScore : null) ??
      0,
    maxScore:
      (typeof item?.max_score === 'number' ? item.max_score : null) ??
      (typeof item?.maxScore === 'number' ? item.maxScore : null) ??
      100,
    requiresApproval:
      (typeof item?.requires_approval === 'boolean' ? item.requires_approval : null) ??
      (typeof item?.requiresApproval === 'boolean' ? item.requiresApproval : null) ??
      false,
    failClosed:
      (typeof item?.fail_closed === 'boolean' ? item.fail_closed : null) ??
      (typeof item?.failClosed === 'boolean' ? item.failClosed : null) ??
      false,
    isDefault:
      (typeof item?.is_default === 'boolean' ? item.is_default : null) ??
      (typeof item?.isDefault === 'boolean' ? item.isDefault : null) ??
      false,
  }
}

export default function EditRiskBandPage({ params }: { params?: { id?: string } }) {
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
        const response = await apiCall<Response>(`/api/agent_governance/risk-bands?id=${encodeURIComponent(id)}`)
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
    { id: 'name', label: t('agent_governance.riskBands.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'riskLevel',
      label: t('agent_governance.riskBands.fields.level', 'Risk level'),
      type: 'select',
      required: true,
      options: [
        { value: 'low', label: t('agent_governance.riskLevels.low', 'Low') },
        { value: 'medium', label: t('agent_governance.riskLevels.medium', 'Medium') },
        { value: 'high', label: t('agent_governance.riskLevels.high', 'High') },
        { value: 'critical', label: t('agent_governance.riskLevels.critical', 'Critical') },
      ],
    },
    { id: 'description', label: t('agent_governance.riskBands.fields.description', 'Description'), type: 'textarea' },
    { id: 'minScore', label: t('agent_governance.riskBands.fields.minScore', 'Min score'), type: 'number', required: true },
    { id: 'maxScore', label: t('agent_governance.riskBands.fields.maxScore', 'Max score'), type: 'number', required: true },
    { id: 'requiresApproval', label: t('agent_governance.riskBands.fields.requiresApproval', 'Requires approval'), type: 'checkbox' },
    { id: 'failClosed', label: t('agent_governance.riskBands.fields.failClosed', 'Fail closed'), type: 'checkbox' },
    { id: 'isDefault', label: t('agent_governance.riskBands.fields.isDefault', 'Default band'), type: 'checkbox' },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('agent_governance.riskBands.editTitle', 'Edit Risk Band')}
          backHref="/backend/agent-governance/risk-bands"
          fields={fields}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('agent_governance.riskBands.loading', 'Loading risk band...')}
          onSubmit={async (values) => {
            await updateCrud('agent_governance/risk-bands', {
              id,
              name: values.name,
              riskLevel: values.riskLevel,
              description: values.description ?? null,
              minScore: Number(values.minScore ?? 0),
              maxScore: Number(values.maxScore ?? 100),
              requiresApproval: Boolean(values.requiresApproval),
              failClosed: Boolean(values.failClosed),
              isDefault: Boolean(values.isDefault),
            })
            router.push('/backend/agent-governance/risk-bands')
            router.refresh()
          }}
          onDelete={async () => {
            await deleteCrud('agent_governance/risk-bands', id)
          }}
          deleteRedirect="/backend/agent-governance/risk-bands"
        />
      </PageBody>
    </Page>
  )
}
