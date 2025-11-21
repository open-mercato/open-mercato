"use client"

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  businessRuleFormSchema,
  createFormGroups,
  createFieldDefinitions,
  type BusinessRuleFormValues,
} from '../../../components/formConfig'
import { ConditionBuilder } from '../../../components/ConditionBuilder'
import { ActionBuilder } from '../../../components/ActionBuilder'
import { buildRulePayload, parseRuleToFormValues } from '../../../components/utils/formHelpers'

export default function EditBusinessRulePage() {
  const router = useRouter()
  const params = useParams()

  // Handle catch-all route: params.slug = ['rules', 'uuid']
  let ruleId: string | undefined
  if (params?.slug && Array.isArray(params.slug)) {
    ruleId = params.slug[1] // Second element is the ID
  } else if (params?.id) {
    ruleId = Array.isArray(params.id) ? params.id[0] : params.id
  }

  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const { data: rule, isLoading, error } = useQuery({
    queryKey: ['business_rule', ruleId],
    queryFn: async () => {
      const response = await apiFetch(`/api/business_rules/rules/${ruleId}`)
      if (!response.ok) {
        throw new Error(t('business_rules.errors.fetchFailed'))
      }
      const result = await response.json()
      return result
    },
    enabled: !!ruleId,
  })

  const initialValues = React.useMemo(() => {
    if (rule) {
      const parsed = parseRuleToFormValues(rule)
      console.log('Rule data:', rule)
      console.log('Parsed initial values:', parsed)
      return parsed
    }
    return null
  }, [rule])

  const handleSubmit = async (values: BusinessRuleFormValues) => {
    const payload = buildRulePayload(values, tenantId, organizationId, undefined)

    const response = await apiFetch(`/api/business_rules/rules/${ruleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || t('business_rules.errors.updateFailed'))
    }

    router.push('/backend/rules')
    router.refresh()
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => createFormGroups(t, ConditionBuilder, ActionBuilder),
    [t]
  )

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  if (error || !rule) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{t('business_rules.errors.loadFailed')}</p>
        </div>
      </div>
    )
  }

  if (!initialValues) {
    return null
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('business_rules.rules.edit.title')}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('business_rules.rules.edit.description')}: <strong>{rule.ruleName}</strong>
        </p>
      </div>
      <CrudForm
        key={ruleId}
        schema={businessRuleFormSchema}
        fields={fields}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        cancelHref="/backend/rules"
        groups={formGroups}
        submitLabel={t('business_rules.rules.form.update')}
      />
    </div>
  )
}
