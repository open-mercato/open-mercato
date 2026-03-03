"use client"

import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
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

export default function CreatePlaybookPage() {
  const router = useRouter()
  const t = useT()

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
          title={t('agent_governance.playbooks.createTitle', 'Create Playbook')}
          backHref="/backend/agent-governance/playbooks"
          fields={fields}
          initialValues={{
            name: '',
            description: '',
            policyId: '',
            riskBandId: '',
            triggerType: 'manual',
            scheduleCron: '',
            isActive: true,
          }}
          onSubmit={async (values) => {
            await createCrud('agent_governance/playbooks', {
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
        />
      </PageBody>
    </Page>
  )
}
