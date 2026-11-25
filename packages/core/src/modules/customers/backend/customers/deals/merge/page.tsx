"use client"

import * as React from 'react'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { fetchCustomFieldFormStructure } from '@open-mercato/ui/backend/utils/customFieldForms'
import {
  DealMergeForm,
  type DealMergeDealMeta,
  type DealMergePreview,
  type DealMergeRequest,
} from './components/DealMergeForm'
import { describeDealMergeError } from './components/dealMergeErrors'

const dealIdSchema = z.string().uuid()

type MergeResponse = { survivorId?: string; result?: { survivorId?: string } }

type DealDetailResponse = {
  deal?: { createdAt?: string | null }
  owner?: { id: string; name?: string | null; email?: string | null } | null
}

async function loadDealMeta(dealId: string): Promise<DealMergeDealMeta | null> {
  try {
    const detail = await readApiResultOrThrow<DealDetailResponse>(
      `/api/customers/deals/${encodeURIComponent(dealId)}`,
    )
    const owner = detail.owner && typeof detail.owner.id === 'string'
      ? { id: detail.owner.id, name: detail.owner.name ?? null, email: detail.owner.email ?? null }
      : null
    return { createdAt: detail.deal?.createdAt ?? null, owner }
  } catch {
    return null
  }
}

export default function DealMergePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const leftId = searchParams?.get('left') ?? ''
  const rightId = searchParams?.get('right') ?? ''
  const validPair = dealIdSchema.safeParse(leftId).success
    && dealIdSchema.safeParse(rightId).success
    && leftId !== rightId
  const [preview, setPreview] = React.useState<DealMergePreview | null>(null)
  const [customFields, setCustomFields] = React.useState<CrudField[]>([])
  const [dealMeta, setDealMeta] = React.useState<Record<string, DealMergeDealMeta>>({})
  const [loading, setLoading] = React.useState(validPair)
  const [refreshing, setRefreshing] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(
    validPair ? null : t('customers.deals.merge.invalidSelection', 'Choose two different deals from the deals list.'),
  )
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const hasPreview = preview !== null
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-deals-merge',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadPreview = React.useCallback(async (mode: 'initial' | 'refresh') => {
    if (!validPair) return
    const loadErrorFallback = t('customers.deals.merge.loadError', 'Failed to load the deals for comparison.')
    if (mode === 'initial') {
      setLoading(true)
      setLoadError(null)
    } else {
      setRefreshing(true)
    }
    try {
      const [result, customFieldStructure, leftMeta, rightMeta] = await Promise.all([
        readApiResultOrThrow<DealMergePreview | { preview: DealMergePreview }>(
          `/api/customers/deals/merge?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`,
          undefined,
          { errorMessage: loadErrorFallback },
        ),
        fetchCustomFieldFormStructure('customers:customer_deal', undefined, { bareIds: true }),
        loadDealMeta(leftId),
        loadDealMeta(rightId),
      ])
      setPreview('preview' in result ? result.preview : result)
      setCustomFields(customFieldStructure.fields)
      setDealMeta({
        ...(leftMeta ? { [leftId]: leftMeta } : {}),
        ...(rightMeta ? { [rightId]: rightMeta } : {}),
      })
      setSubmitError(null)
    } catch (error) {
      const message = describeDealMergeError(error, t, loadErrorFallback)
      if (mode === 'initial') setLoadError(message)
      else setSubmitError(message)
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [leftId, rightId, t, validPair])

  React.useEffect(() => {
    void loadPreview('initial')
  }, [loadPreview])

  const refreshComparison = React.useCallback(() => {
    void loadPreview(hasPreview ? 'refresh' : 'initial')
  }, [hasPreview, loadPreview])

  const handleSubmit = React.useCallback(async (request: DealMergeRequest) => {
    setConfirmOpen(true)
    let accepted = false
    try {
      accepted = await confirm({
        title: t('customers.deals.merge.confirm.title', 'Merge these deals?'),
        description: t('customers.deals.merge.confirm.description', 'The source deal will be removed after all selected data and related records are transferred.'),
        confirmText: t('customers.deals.merge.confirm.action', 'Merge deals'),
        variant: 'destructive',
      })
    } finally {
      setConfirmOpen(false)
    }
    if (!accepted) return
    setPending(true)
    setSubmitError(null)
    const submitErrorFallback = t('customers.deals.merge.submitError', 'Failed to merge the deals.')
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow<MergeResponse>('/api/customers/deals/merge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        }, { errorMessage: submitErrorFallback }),
        context: {
          formId: 'customers-deals-merge',
          resourceKind: 'customers.deal',
          resourceId: request.survivorId,
          retryLastMutation,
        },
        mutationPayload: request,
      })
      const survivorId = call.result?.survivorId ?? call.result?.result?.survivorId ?? request.survivorId
      router.push(`/backend/customers/deals/${encodeURIComponent(survivorId)}`)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: refreshComparison })) {
        setSubmitError(t('customers.deals.merge.conflict', 'One of the deals changed after the comparison was loaded. Refresh the comparison; your choices are kept.'))
        return
      }
      const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
      if (status === 409) {
        setSubmitError(t('customers.deals.merge.conflict', 'One of the deals changed after the comparison was loaded. Refresh the comparison; your choices are kept.'))
        return
      }
      setSubmitError(describeDealMergeError(error, t, submitErrorFallback))
    } finally {
      setPending(false)
    }
  }, [confirm, refreshComparison, retryLastMutation, router, runMutation, t])

  const handleCancel = React.useCallback(() => router.push('/backend/customers/deals'), [router])

  return (
    <Page>
      <PageBody>
        {preview ? (
          <DealMergeForm
            preview={preview}
            customFieldDefinitions={customFields}
            dealMeta={dealMeta}
            pending={pending}
            refreshing={refreshing}
            shortcutsBlocked={confirmOpen || pending}
            submitError={submitError}
            onRefresh={refreshComparison}
            onCancel={handleCancel}
            onSubmit={handleSubmit}
          />
        ) : loading ? (
          <LoadingMessage label={t('customers.deals.merge.loading', 'Loading deals for comparison…')} />
        ) : (
          <ErrorMessage
            label={loadError ?? t('customers.deals.merge.loadError', 'Failed to load the deals for comparison.')}
            action={<div className="flex flex-wrap gap-2">
              {validPair ? <Button type="button" variant="outline" onClick={() => void loadPreview('initial')}>{t('customers.deals.merge.retry', 'Try again')}</Button> : null}
              <Button type="button" variant="outline" onClick={handleCancel}>{t('customers.deals.merge.back', 'Back to deals')}</Button>
            </div>}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
