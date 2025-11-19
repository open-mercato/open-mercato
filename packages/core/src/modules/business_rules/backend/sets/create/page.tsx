"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { z } from 'zod'

const ruleSetFormSchema = z.object({
  setId: z.string().min(1, 'Set ID is required').max(50),
  setName: z.string().min(1, 'Set name is required').max(200),
  description: z.string().max(5000).optional().nullable(),
  enabled: z.boolean().optional(),
})

type RuleSetFormValues = z.infer<typeof ruleSetFormSchema>

export default function CreateRuleSetPage() {
  const router = useRouter()
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const handleSubmit = async (values: RuleSetFormValues) => {
    const payload = {
      ...values,
      tenantId,
      organizationId,
      enabled: values.enabled ?? true,
    }

    const response = await apiFetch('/api/business_rules/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to create rule set')
    }

    const result = await response.json()
    router.push(`/backend/sets/${result.id}`)
  }

  const handleCancel = () => {
    router.push('/backend/sets')
  }

  const fields: CrudField[] = [
    {
      id: 'setId',
      label: t('business_rules.sets.form.setId'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.sets.form.placeholders.setId'),
      description: t('business_rules.sets.form.descriptions.setId'),
    },
    {
      id: 'setName',
      label: t('business_rules.sets.form.setName'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.sets.form.placeholders.setName'),
    },
    {
      id: 'description',
      label: t('business_rules.sets.form.description'),
      type: 'textarea',
      placeholder: t('business_rules.sets.form.placeholders.description'),
      rows: 3,
    },
    {
      id: 'enabled',
      label: t('business_rules.sets.form.enabled'),
      type: 'checkbox',
      description: t('business_rules.sets.form.descriptions.enabled'),
    },
  ]

  const defaultValues: Partial<RuleSetFormValues> = {
    enabled: true,
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('business_rules.sets.create.title')}</h1>
        <p className="text-sm text-gray-600 mt-1">{t('business_rules.sets.create.description')}</p>
      </div>
      <CrudForm
        schema={ruleSetFormSchema}
        fields={fields}
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        submitLabel={t('business_rules.sets.form.create')}
        cancelLabel={t('business_rules.sets.form.cancel')}
      />
    </div>
  )
}
