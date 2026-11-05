import * as React from 'react'
import { useRouter } from 'next/navigation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { DealFormSubmitPayload } from '../../../../../components/detail/DealForm'
import type { DealDetailPayload, GuardedMutationRunner } from './types'

type UseDealFormHandlersOptions = {
  data: DealDetailPayload | null
  currentDealId: string | null
  loadData: () => Promise<void>
  runMutationWithContext: GuardedMutationRunner
  formWrapperRef: React.RefObject<HTMLDivElement | null>
  confirm: ReturnType<typeof useConfirmDialog>['confirm']
}

type UseDealFormHandlersResult = {
  isSaving: boolean
  handleFormSubmit: (payload: DealFormSubmitPayload) => Promise<void>
  handleDelete: () => Promise<void>
  handleHeaderSave: () => void
}

export function useDealFormHandlers({
  data,
  currentDealId,
  loadData,
  runMutationWithContext,
  formWrapperRef,
  confirm,
}: UseDealFormHandlersOptions): UseDealFormHandlersResult {
  const t = useT()
  const router = useRouter()
  const [isSaving, setIsSaving] = React.useState(false)

  const handleFormSubmit = React.useCallback(
    async (payload: DealFormSubmitPayload) => {
      if (!data) return
      setIsSaving(true)
      try {
        const body: Record<string, unknown> = {
          id: data.deal.id,
          ...payload.base,
        }
        // Custom-field values MUST travel under `customFields` (bare keys). The
        // deal update route's `splitCustomFieldPayload` only routes
        // `customFields`/`customValues`/`cf_`/`cf:` entries to the custom-field
        // writer; spreading bare keys into the body would land them in `base`
        // where `dealUpdateSchema.parse` silently drops them, so edits never
        // persisted (boolean/select/multi all reverted on refresh).
        if (payload.custom && Object.keys(payload.custom).length) {
          body.customFields = payload.custom
        }
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(data.deal.updatedAt),
          () => updateCrud('customers/deals', body),
        )
        flash(t('customers.deals.detail.updateSuccess', 'Deal updated.'), 'success')
        await loadData()
      } finally {
        setIsSaving(false)
      }
    },
    [data, loadData, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!data || !currentDealId) return
    const approved = await confirm({
      title: t('customers.deals.detail.deleteConfirmTitle', 'Delete deal?'),
      description: t('customers.deals.detail.deleteConfirmDescription', 'This action cannot be undone.'),
      confirmText: t('customers.deals.detail.actions.delete', 'Delete'),
      cancelText: t('customers.deals.detail.actions.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!approved) return
    try {
      await runMutationWithContext(
        () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(data.deal.updatedAt),
          () => deleteCrud('customers/deals', currentDealId),
        ),
        { id: currentDealId, operation: 'deleteDeal' },
      )
    } catch (err) {
      // The guarded mutation routes a 409 to the unified conflict bar; surface
      // any other server error as a flash instead of letting it crash the page.
      if (!surfaceRecordConflict(err, t)) {
        flash(
          err instanceof Error && err.message.trim().length > 0
            ? err.message
            : t('customers.deals.detail.deleteError', 'Failed to delete deal.'),
          'error',
        )
      }
      return
    }
    flash(t('customers.deals.detail.deleteSuccess', 'Deal deleted.'), 'success')
    router.push('/backend/customers/deals')
  }, [confirm, currentDealId, data, router, runMutationWithContext, t])

  const handleHeaderSave = React.useCallback(() => {
    const form = formWrapperRef.current?.querySelector('form')
    if (form) form.requestSubmit()
  }, [formWrapperRef])

  return {
    isSaving,
    handleFormSubmit,
    handleDelete,
    handleHeaderSave,
  }
}
