"use client"

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { z } from 'zod'
import { RuleSetMembers } from './RuleSetMembers'

const ruleSetFormSchema = z.object({
  setId: z.string().min(1).max(50),
  setName: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  enabled: z.boolean().optional(),
})

type RuleSetFormValues = z.infer<typeof ruleSetFormSchema>

type RuleSetDetail = {
  id: string
  setId: string
  setName: string
  description: string | null
  enabled: boolean
  tenantId: string
  organizationId: string
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  members: Array<{
    id: string
    ruleId: string
    ruleName: string
    ruleType: string
    sequence: number
    enabled: boolean
  }>
}

export default function EditRuleSetPage() {
  const router = useRouter()
  const params = useParams()

  // Handle catch-all route: params.slug = ['sets', 'uuid']
  let setId: string | undefined
  if (params?.slug && Array.isArray(params.slug)) {
    setId = params.slug[1] // Second element is the ID
  } else if (params?.id) {
    setId = Array.isArray(params.id) ? params.id[0] : params.id
  }

  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const queryClient = useQueryClient()

  const { data: ruleSet, isLoading, error } = useQuery({
    queryKey: ['business-rules', 'sets', setId],
    queryFn: async () => {
      const response = await apiFetch(`/api/business_rules/sets/${setId}`)
      if (!response.ok) {
        throw new Error(t('business_rules.sets.errors.fetchFailed'))
      }
      const result = await response.json()
      return result as RuleSetDetail
    },
    enabled: !!setId,
  })

  const handleSubmit = async (values: RuleSetFormValues) => {
    const payload = {
      id: setId,
      ...values,
    }

    const response = await apiFetch('/api/business_rules/sets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || t('business_rules.sets.errors.updateFailed'))
    }

    flash.success(t('business_rules.sets.messages.updated'))
    queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
  }

  const handleAddMember = async (ruleId: string, sequence: number) => {
    const result = await apiCall(`/api/business_rules/sets/${setId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ruleId,
        sequence,
        enabled: true,
      }),
    })

    if (result.ok) {
      flash.success(t('business_rules.sets.members.messages.added'))
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
    } else {
      if (result.result?.error?.includes('duplicate') || result.result?.message?.includes('exists')) {
        flash.error(t('business_rules.sets.members.messages.alreadyExists'))
      } else {
        flash.error(t('business_rules.sets.members.messages.addFailed'))
      }
    }
  }

  const handleUpdateMember = async (memberId: string, updates: { sequence?: number; enabled?: boolean }) => {
    const result = await apiCall(`/api/business_rules/sets/${setId}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId,
        ...updates,
      }),
    })

    if (result.ok) {
      flash.success(t('business_rules.sets.members.messages.updated'))
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
    } else {
      flash.error(t('business_rules.sets.members.messages.updateFailed'))
    }
  }

  const handleRemoveMember = async (memberId: string, ruleName: string) => {
    if (!confirm(t('business_rules.sets.members.confirm.remove', { name: ruleName }))) {
      return
    }

    const result = await apiCall(`/api/business_rules/sets/${setId}/members?memberId=${memberId}`, {
      method: 'DELETE',
    })

    if (result.ok) {
      flash.success(t('business_rules.sets.members.messages.removed'))
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
    } else {
      flash.error(t('business_rules.sets.members.messages.removeFailed'))
    }
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

  if (error || !ruleSet) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800 font-semibold">{t('business_rules.sets.messages.loadFailed')}</p>
          {error && (
            <p className="text-red-700 text-sm mt-2">
              {t('business_rules.sets.errors.errorDetails')}: {error instanceof Error ? error.message : String(error)}
            </p>
          )}
          <p className="text-gray-600 text-sm mt-2">{t('business_rules.sets.fields.setId')}: {setId}</p>
        </div>
      </div>
    )
  }

  const initialValues: Partial<RuleSetFormValues> = {
    setId: ruleSet.setId,
    setName: ruleSet.setName,
    description: ruleSet.description,
    enabled: ruleSet.enabled,
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('business_rules.sets.edit.title')}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('business_rules.sets.edit.description')}: <strong>{ruleSet.setName}</strong>
        </p>
      </div>

      <div className="space-y-8">
        {/* Rule Set Details Form */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">{t('business_rules.sets.edit.detailsSection')}</h2>
          <CrudForm
            schema={ruleSetFormSchema}
            fields={fields}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            submitLabel={t('business_rules.sets.form.update')}
            cancelLabel={t('business_rules.sets.form.cancel')}
            embedded
          />
        </div>

        {/* Rule Set Members Management */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">{t('business_rules.sets.edit.membersSection')}</h2>
          <RuleSetMembers
            members={ruleSet.members}
            onAdd={handleAddMember}
            onUpdate={handleUpdateMember}
            onRemove={handleRemoveMember}
          />
        </div>
      </div>
    </div>
  )
}
