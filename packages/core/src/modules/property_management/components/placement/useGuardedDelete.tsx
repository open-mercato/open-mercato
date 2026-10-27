"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

export type GuardedDeleteRequest = {
  resource: 'spaces' | 'units' | 'common-areas'
  resourceKind: string
  id: string
  updatedAt: string | null
  title: string
  description?: string
  successMessage: string
  errorMessage: string
  onDeleted?: () => void
  onRefresh?: () => void
}

type DeleteMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

export function useGuardedDelete(contextId: string) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<DeleteMutationContext>({
    contextId,
    blockedMessage: t('property_management.common.blocked', 'The change was blocked.'),
  })

  const remove = React.useCallback(async (request: GuardedDeleteRequest): Promise<boolean> => {
    const confirmed = await confirm({ title: request.title, description: request.description, variant: 'destructive' })
    if (!confirmed) return false
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(request.updatedAt), () =>
            deleteCrud(`property_management/${request.resource}`, request.id, { errorMessage: request.errorMessage }),
          ),
        mutationPayload: { id: request.id },
        context: { formId: contextId, resourceKind: request.resourceKind, resourceId: request.id, retryLastMutation },
      })
      flash(request.successMessage, 'success')
      request.onDeleted?.()
      return true
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: request.onRefresh })) return false
      flash(error instanceof Error && error.message ? error.message : request.errorMessage, 'error')
      return false
    }
  }, [confirm, contextId, retryLastMutation, runMutation, t])

  return { remove, ConfirmDialogElement }
}
