"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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

  const handleSubmit = async (values: BusinessRuleFormValues) => {
    // Note: tenantId and organizationId are injected by the API from auth token
    // We only send the rule-specific data
    const payload = {
      ruleId: values.ruleId,
      ruleName: values.ruleName,
      description: values.description || null,
      ruleType: values.ruleType,
      ruleCategory: values.ruleCategory || null,
      entityType: values.entityType,
      eventType: values.eventType || null,
      conditionExpression: values.conditionExpression,
      successActions: values.successActions || null,
      failureActions: values.failureActions || null,
      enabled: values.enabled,
      priority: values.priority,
      version: values.version,
      effectiveFrom: values.effectiveFrom || null,
      effectiveTo: values.effectiveTo || null,
    }

    const response = await apiFetch('/api/business_rules/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || t('business_rules.errors.createFailed'))
    }

    const result = await response.json()
    router.push(`/backend/rules/${result.id}`)
    router.refresh()
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => createFormGroups(t, ConditionBuilder, ActionBuilder),
    [t]
  )

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('business_rules.rules.create.title')}
          backHref="/backend/rules"
          schema={businessRuleFormSchema}
          fields={fields}
          initialValues={defaultFormValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/rules"
          groups={formGroups}
          submitLabel={t('business_rules.rules.form.create')}
        />
      </PageBody>
    </Page>
  )
}
