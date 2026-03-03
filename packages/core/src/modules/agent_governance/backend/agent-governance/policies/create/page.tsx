"use client"

import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormValues = {
  name: string
  description?: string | null
  defaultMode: 'propose' | 'assist' | 'auto'
  isActive: boolean
}

export default function CreatePolicyPage() {
  const router = useRouter()
  const t = useT()

  const fields: CrudField[] = [
    { id: 'name', label: t('agent_governance.policies.fields.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('agent_governance.policies.fields.description', 'Description'), type: 'textarea' },
    {
      id: 'defaultMode',
      label: t('agent_governance.policies.fields.defaultMode', 'Default mode'),
      type: 'select',
      options: [
        { value: 'propose', label: t('agent_governance.modes.propose', 'Propose') },
        { value: 'assist', label: t('agent_governance.modes.assist', 'Assist') },
        { value: 'auto', label: t('agent_governance.modes.auto', 'Auto') },
      ],
      required: true,
    },
    { id: 'isActive', label: t('agent_governance.policies.fields.active', 'Active'), type: 'checkbox' },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('agent_governance.policies.createTitle', 'Create Policy')}
          backHref="/backend/agent-governance/policies"
          fields={fields}
          initialValues={{
            name: '',
            description: '',
            defaultMode: 'propose',
            isActive: true,
          }}
          onSubmit={async (values) => {
            await createCrud('agent_governance/policies', {
              name: values.name,
              description: values.description ?? null,
              defaultMode: values.defaultMode,
              isActive: Boolean(values.isActive),
            })
            router.push('/backend/agent-governance/policies')
            router.refresh()
          }}
        />
      </PageBody>
    </Page>
  )
}
