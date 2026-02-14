"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { z } from 'zod'
import { RuleSetMembers } from '@open-mercato/core/modules/business_rules/components/RuleSetMembers'

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
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

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

    flash(t('business_rules.sets.messages.updated'), 'success')
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
      flash(t('business_rules.sets.members.messages.added'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
    } else {
      const error = result.result as { error?: string; message?: string } | null
      if (error?.error?.includes('duplicate') || error?.message?.includes('exists')) {
        flash(t('business_rules.sets.members.messages.alreadyExists'), 'error')
      } else {
        flash(t('business_rules.sets.members.messages.addFailed'), 'error')
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
      flash(t('business_rules.sets.members.messages.updated'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
    } else {
      flash(t('business_rules.sets.members.messages.updateFailed'), 'error')
    }
  }

  const handleRemoveMember = async (memberId: string, ruleName: string) => {
    const confirmed = await confirm({
      title: t('business_rules.sets.members.confirm.remove', { name: ruleName }),
      variant: 'destructive',
    })
    if (!confirmed) return

    const result = await apiCall(`/api/business_rules/sets/${setId}/members?memberId=${memberId}`, {
      method: 'DELETE',
    })

    if (result.ok) {
      flash(t('business_rules.sets.members.messages.removed'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets', setId] })
    } else {
      flash(t('business_rules.sets.members.messages.removeFailed'), 'error')
    }
  }

  const fields: CrudField[] = React.useMemo(() => [
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
    },
    {
      id: 'enabled',
      label: t('business_rules.sets.form.enabled'),
      type: 'checkbox',
      description: t('business_rules.sets.form.descriptions.enabled'),
    },
  ], [t])

  const initialValues: Partial<RuleSetFormValues> = React.useMemo(() => {
    if (!ruleSet) return {}
    return {
      setId: ruleSet.setId,
      setName: ruleSet.setName,
      description: ruleSet.description,
      enabled: ruleSet.enabled,
    }
  }, [ruleSet])

  const formGroups = React.useMemo(() => {
    if (!ruleSet) return []
    return [
      {
        id: 'details',
        title: t('business_rules.sets.edit.detailsSection'),
        column: 1 as const,
        fields: ['setId', 'setName', 'description', 'enabled'],
      },
      {
        id: 'members',
        title: t('business_rules.sets.edit.membersSection'),
        column: 1 as const,
        component: () => (
          <RuleSetMembers
            members={ruleSet.members}
            onAdd={handleAddMember}
            onUpdate={handleUpdateMember}
            onRemove={handleRemoveMember}
          />
        ),
      },
    ]
  }, [t, ruleSet, handleAddMember, handleUpdateMember, handleRemoveMember])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('business_rules.sets.edit.loading')}</span>
          </div>
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  if (error || !ruleSet) {
    return (
      <Page>
        <PageBody>
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{t('business_rules.sets.messages.loadFailed')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/sets">{t('business_rules.sets.backToList')}</Link>
            </Button>
          </div>
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('business_rules.sets.edit.title')}
          backHref="/backend/sets"
          schema={ruleSetFormSchema}
          fields={fields}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/sets"
          submitLabel={t('business_rules.sets.form.update')}
          groups={formGroups}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
