"use client"

import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
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

export default function CreateRiskBandPage() {
  const router = useRouter()
  const t = useT()

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
          title={t('agent_governance.riskBands.createTitle', 'Create Risk Band')}
          backHref="/backend/agent-governance/risk-bands"
          fields={fields}
          initialValues={{
            name: '',
            riskLevel: 'low',
            description: '',
            minScore: 0,
            maxScore: 100,
            requiresApproval: false,
            failClosed: false,
            isDefault: false,
          }}
          onSubmit={async (values) => {
            await createCrud('agent_governance/risk-bands', {
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
        />
      </PageBody>
    </Page>
  )
}
