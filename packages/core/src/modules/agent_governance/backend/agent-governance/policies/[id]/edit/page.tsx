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
  defaultMode: 'propose' | 'assist' | 'auto'
  isActive: boolean
}

type PolicyResponse = {
  items?: Array<Record<string, unknown>>
}

function mapInitial(item: Record<string, unknown> | null): FormValues {
  return {
    name: typeof item?.name === 'string' ? item.name : '',
    description: typeof item?.description === 'string' ? item.description : '',
    defaultMode:
      (typeof item?.default_mode === 'string' ? item.default_mode : null) === 'assist' ||
      (typeof item?.default_mode === 'string' ? item.default_mode : null) === 'auto'
        ? (item?.default_mode as 'assist' | 'auto')
        : (typeof item?.defaultMode === 'string' && (item.defaultMode === 'assist' || item.defaultMode === 'auto')
          ? item.defaultMode
          : 'propose'),
    isActive:
      (typeof item?.is_active === 'boolean' ? item.is_active : null) ??
      (typeof item?.isActive === 'boolean' ? item.isActive : true),
  }
}

export default function EditPolicyPage({ params }: { params?: { id?: string } }) {
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
        const response = await apiCall<PolicyResponse>(`/api/agent_governance/policies?id=${encodeURIComponent(id)}`)
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
          title={t('agent_governance.policies.editTitle', 'Edit Policy')}
          backHref="/backend/agent-governance/policies"
          fields={fields}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('agent_governance.policies.loading', 'Loading policy...')}
          onSubmit={async (values) => {
            await updateCrud('agent_governance/policies', {
              id,
              name: values.name,
              description: values.description ?? null,
              defaultMode: values.defaultMode,
              isActive: Boolean(values.isActive),
            })
            router.push('/backend/agent-governance/policies')
            router.refresh()
          }}
          onDelete={async () => {
            await deleteCrud('agent_governance/policies', id)
          }}
          deleteRedirect="/backend/agent-governance/policies"
        />
      </PageBody>
    </Page>
  )
}
