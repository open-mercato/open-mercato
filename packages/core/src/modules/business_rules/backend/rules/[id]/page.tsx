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

  const formGroups = React.useMemo(
    () => createFormGroups(t, ConditionBuilder, ActionBuilder),
    [t]
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
