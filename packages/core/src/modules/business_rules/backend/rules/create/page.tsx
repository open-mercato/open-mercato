"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useAiFormBridge, AiSuggestionBanner } from '@open-mercato/ai-assistant/frontend'
import { Sparkles } from 'lucide-react'
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

  // Track current form values for AI bridge (updated via ref from CrudForm wrappers)
  const formValuesRef = React.useRef<Record<string, unknown>>({
    conditionExpression: null,
    successActions: null,
    failureActions: null,
  })

  const bridge = useAiFormBridge({
    formType: 'business_rules',
    getFormState: () => formValuesRef.current,
  })

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

  const renderSuggestionBanner = React.useCallback(
    (sectionId: string, currentValue: unknown, setValue: (value: unknown) => void) => {
      // Keep form values ref in sync for AI bridge
      formValuesRef.current[sectionId] = currentValue

      const section = bridge.getSuggestionSection(sectionId)
      const isGenerating = bridge.isSectionGenerating(sectionId)
      if (!section && !isGenerating) return null

      return (
        <AiSuggestionBanner
          section={section}
          currentValue={currentValue}
          onAccept={(value) => {
            bridge.acceptSection(sectionId)
            setValue(value)
          }}
          onReject={() => bridge.rejectSection(sectionId)}
          isStale={bridge.isSectionStale(sectionId, currentValue)}
          isGenerating={isGenerating}
        />
      )
    },
    [bridge]
  )

  const formGroups = React.useMemo(
    () => createFormGroups(t, ConditionBuilder, ActionBuilder, renderSuggestionBanner),
    [t, renderSuggestionBanner]
  )

  return (
    <Page>
      <PageBody>
        {bridge.isAiConnected && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-sky-500" />
            <span>{t('ai_assistant.form_bridge.ai_connected')}</span>
          </div>
        )}
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
