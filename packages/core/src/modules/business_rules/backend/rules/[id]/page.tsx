"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useAiFormBridge, AiSuggestionBanner } from '@open-mercato/ai-assistant/frontend'
import { Sparkles } from 'lucide-react'
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

  // Track current form values for AI bridge (updated via ref from CrudForm wrappers)
  const formValuesRef = React.useRef<Record<string, unknown>>({
    conditionExpression: null,
    successActions: null,
    failureActions: null,
  })

  const bridge = useAiFormBridge({
    formType: 'business_rules',
    getFormState: () => ({
      ...formValuesRef.current,
      metadata: rule ? {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        entityType: rule.entityType,
        eventType: rule.eventType,
        category: rule.category,
      } : undefined,
    }),
  })

  const handleSubmit = async (values: BusinessRuleFormValues) => {
    // Use tenant/org from the loaded rule if available, otherwise from context
    const effectiveTenantId = rule?.tenantId || tenantId
    const effectiveOrgId = rule?.organizationId || organizationId

    if (!effectiveTenantId || !effectiveOrgId) {
      throw new Error(t('business_rules.errors.missingTenantOrOrg'))
    }

    const payload = buildRulePayload(values, effectiveTenantId, effectiveOrgId, undefined)

    const response = await apiFetch('/api/business_rules/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        id: ruleId,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || t('business_rules.errors.updateFailed'))
    }

    router.push('/backend/rules')
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

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('business_rules.rules.edit.loading')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !rule) {
    return (
      <Page>
        <PageBody>
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{t('business_rules.errors.loadFailed')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/rules">{t('business_rules.rules.backToList')}</Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (!initialValues) {
    return null
  }

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
          key={ruleId}
          title={t('business_rules.rules.edit.title')}
          backHref="/backend/rules"
          schema={businessRuleFormSchema}
          fields={fields}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/rules"
          groups={formGroups}
          submitLabel={t('business_rules.rules.form.update')}
        />
      </PageBody>
    </Page>
  )
}
