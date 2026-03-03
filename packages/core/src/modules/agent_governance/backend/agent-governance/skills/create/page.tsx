"use client"

import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormValues = {
  name: string
  description?: string | null
  sourceType: 'interview' | 'trace_mining' | 'hybrid'
  status: 'draft' | 'validated' | 'active' | 'deprecated'
  frameworkJson: string
}

function parseFrameworkJson(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Framework JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}

export default function CreateSkillPage() {
  const router = useRouter()
  const t = useT()

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
          title={t('agent_governance.skills.createTitle', 'Create Skill')}
          backHref="/backend/agent-governance/skills"
          fields={fields}
          initialValues={{
            name: '',
            description: '',
            sourceType: 'hybrid',
            status: 'draft',
            frameworkJson: '',
          }}
          onSubmit={async (values) => {
            let frameworkJson: Record<string, unknown> | null = null
            try {
              frameworkJson = parseFrameworkJson(values.frameworkJson)
            } catch {
              const message = t('agent_governance.skills.errors.invalidJson', 'Framework JSON is invalid.')
              throw createCrudFormError(message, { frameworkJson: message })
            }

            await createCrud('agent_governance/skills', {
              name: values.name,
              description: values.description ?? null,
              sourceType: values.sourceType,
              status: values.status,
              frameworkJson,
            })
            router.push('/backend/agent-governance/skills')
            router.refresh()
          }}
        />
      </PageBody>
    </Page>
  )
}
