"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  businessRuleFormSchema,
  createFormGroups,
  createFieldDefinitions,
  defaultFormValues,
  type BusinessRuleFormValues,
} from '../../../components/formConfig'
import { ConditionBuilder } from '../../../components/ConditionBuilder'
import { ActionBuilder } from '../../../components/ActionBuilder'
import { buildRulePayload } from '../../../components/utils/formHelpers'

export default function CreateBusinessRulePage() {
  const router = useRouter()
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const handleSubmit = async (values: BusinessRuleFormValues) => {
    const payload = buildRulePayload(values, tenantId, organizationId, undefined)

    const response = await apiFetch('/api/business_rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to create business rule')
    }

    const result = await response.json()
    router.push(`/backend/rules/${result.data.id}`)
  }

  const handleCancel = () => {
    router.push('/backend/rules')
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => createFormGroups(t, ConditionBuilder, ActionBuilder),
    [t]
  )

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Create Business Rule</h1>
        <p className="text-sm text-gray-600 mt-1">Define a new business rule with conditions and actions</p>
      </div>
      <CrudForm
        schema={businessRuleFormSchema}
        fields={fields}
        defaultValues={defaultFormValues}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        groups={formGroups}
        submitLabel={t('business_rules.rules.form.create')}
        cancelLabel={t('business_rules.rules.form.cancel')}
      />
    </div>
  )
}
