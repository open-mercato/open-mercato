'use client'

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { InteractionSummary } from '../types'
import type { GuardedMutationRunner } from './useInteractionMutations'

const logger = createLogger('customers')

export type UseActivityDeleteOptions = {
  runMutation?: GuardedMutationRunner
  onAfterDelete?: () => void | Promise<void>
  /** Log prefix used when the delete throws, e.g. "ActivitiesSection". */
  logContext?: string
}

export type UseActivityDeleteResult = {
  deleteActivity: (activity: InteractionSummary) => Promise<void>
  /** Mount once per timeline so every row shares a single confirmation dialog. */
  ConfirmDialogElement: React.ReactNode
}

/**
 * Shared delete handler for the activity timelines on customer detail pages:
 * confirms that the activity is removed everywhere, sends the optimistic-lock version,
 * routes through the page's guarded mutation when one is provided, and refreshes.
 */
export function useActivityDelete({
  runMutation,
  onAfterDelete,
  logContext = 'customers.activityDelete',
}: UseActivityDeleteOptions): UseActivityDeleteResult {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const triggerRefresh = React.useCallback(async () => {
    if (!onAfterDelete) return
    try {
      await onAfterDelete()
    } catch (err) {
      logger.warn('onAfterDelete threw', { component: logContext, err })
    }
  }, [logContext, onAfterDelete])

  const deleteActivity = React.useCallback(
    async (activity: InteractionSummary) => {
      const confirmed = await confirm({
        title: t('customers.activities.actions.deleteConfirmTitle', 'Delete activity?'),
        description: t(
          'customers.activities.actions.deleteConfirmDescription',
          'The activity will be removed everywhere it appears, not only from this list.',
        ),
        confirmText: t('customers.activities.actions.delete', 'Delete activity'),
        cancelText: t('customers.activities.actions.deleteCancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const operation = () =>
        withScopedApiRequestHeaders(buildOptimisticLockHeader(activity.updatedAt ?? null), () =>
          apiCallOrThrow('/api/customers/interactions', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: activity.id }),
          }),
        )
      try {
        if (runMutation) {
          await runMutation(operation, { id: activity.id, operation: 'deleteActivity' })
        } else {
          await operation()
        }
        flash(t('customers.activities.actions.deleteSuccess', 'Activity deleted'), 'success')
        await triggerRefresh()
      } catch (err) {
        if (surfaceRecordConflict(err, t)) {
          await triggerRefresh()
          return
        }
        logger.warn('Delete activity failed', { component: logContext, activityId: activity.id, err })
        flash(t('customers.activities.actions.deleteError', 'Could not delete activity'), 'error')
      }
    },
    [confirm, logContext, runMutation, t, triggerRefresh],
  )

  return { deleteActivity, ConfirmDialogElement }
}
