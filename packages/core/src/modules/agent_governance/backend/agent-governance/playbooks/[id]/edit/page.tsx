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
  description?: string | null
  policyId?: string | null
  riskBandId?: string | null
  triggerType: 'manual' | 'scheduled'
  scheduleCron?: string | null
  isActive: boolean
}

type Response = {
  items?: Array<Record<string, unknown>>
}

function mapInitial(item: Record<string, unknown> | null): FormValues {
  const triggerRaw =
    (typeof item?.trigger_type === 'string' ? item.trigger_type : null) ??
    (typeof item?.triggerType === 'string' ? item.triggerType : null)

  return {
    name: typeof item?.name === 'string' ? item.name : '',
    description: typeof item?.description === 'string' ? item.description : '',
    policyId:
      (typeof item?.policy_id === 'string' ? item.policy_id : null) ??
      (typeof item?.policyId === 'string' ? item.policyId : null) ??
      '',
    riskBandId:
      (typeof item?.risk_band_id === 'string' ? item.risk_band_id : null) ??
      (typeof item?.riskBandId === 'string' ? item.riskBandId : null) ??
      '',
    triggerType: triggerRaw === 'scheduled' ? 'scheduled' : 'manual',
    scheduleCron:
      (typeof item?.schedule_cron === 'string' ? item.schedule_cron : null) ??
      (typeof item?.scheduleCron === 'string' ? item.scheduleCron : null) ??
      '',
    isActive:
      (typeof item?.is_active === 'boolean' ? item.is_active : null) ??
      (typeof item?.isActive === 'boolean' ? item.isActive : null) ??
      true,
  }
}

export default function EditPlaybookPage({ params }: { params?: { id?: string } }) {
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
        const response = await apiCall<Response>(`/api/agent_governance/playbooks?id=${encodeURIComponent(id)}`)
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
    { id: 'name', label: t('agent_governance.playbooks.fields.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('agent_governance.playbooks.fields.description', 'Description'), type: 'textarea' },
    { id: 'policyId', label: t('agent_governance.playbooks.fields.policyId', 'Policy ID'), type: 'text' },
    { id: 'riskBandId', label: t('agent_governance.playbooks.fields.riskBandId', 'Risk band ID'), type: 'text' },
    {
      id: 'triggerType',
      label: t('agent_governance.playbooks.fields.triggerType', 'Trigger'),
      type: 'select',
      options: [
        { value: 'manual', label: t('agent_governance.playbooks.triggers.manual', 'Manual') },
        { value: 'scheduled', label: t('agent_governance.playbooks.triggers.scheduled', 'Scheduled') },
      ],
      required: true,
    },
    { id: 'scheduleCron', label: t('agent_governance.playbooks.fields.scheduleCron', 'Schedule Cron'), type: 'text' },
    { id: 'isActive', label: t('agent_governance.playbooks.fields.active', 'Active'), type: 'checkbox' },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('agent_governance.playbooks.editTitle', 'Edit Playbook')}
          backHref="/backend/agent-governance/playbooks"
          fields={fields}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('agent_governance.playbooks.loading', 'Loading playbook...')}
          onSubmit={async (values) => {
            await updateCrud('agent_governance/playbooks', {
              id,
              name: values.name,
              description: values.description ?? null,
              policyId: values.policyId?.trim() || null,
              riskBandId: values.riskBandId?.trim() || null,
              triggerType: values.triggerType,
              scheduleCron: values.scheduleCron?.trim() || null,
              isActive: Boolean(values.isActive),
            })
            router.push('/backend/agent-governance/playbooks')
            router.refresh()
          }}
          onDelete={async () => {
            await deleteCrud('agent_governance/playbooks', id)
          }}
          deleteRedirect="/backend/agent-governance/playbooks"
        />
      </PageBody>
    </Page>
  )
}
