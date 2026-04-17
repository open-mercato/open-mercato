import * as React from 'react'
import { useRouter } from 'next/navigation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
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
        await updateCrud('customers/deals', {
          id: data.deal.id,
          ...payload.base,
          ...payload.custom,
        })
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
    await runMutationWithContext(
      () => deleteCrud('customers/deals', currentDealId),
      { id: currentDealId, operation: 'deleteDeal' },
    )
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
