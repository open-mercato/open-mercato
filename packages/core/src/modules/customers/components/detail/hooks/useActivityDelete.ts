'use client'

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { InteractionSummary } from '../types'
import type { GuardedMutationRunner } from './useInteractionMutations'

const logger = createLogger('customers')

const LEGACY_ACTIVITY_SOURCE = 'legacy-activity'
const CANONICAL_DELETE_ENDPOINT = '/api/customers/interactions'
const LEGACY_DELETE_ENDPOINT = '/api/customers/activities'

/**
 * A timeline row that still lives only in `customer_activities` has no canonical
 * interaction for the interactions endpoint to find. The activities adapter bridges the
 * row first and then deletes it. Its `updatedAt` is a placeholder copied from `createdAt`,
 * not a version of the record the bridge creates, so sending it would turn every such
 * delete into a false conflict.
 */
function resolveDeleteTarget(activity: InteractionSummary): { endpoint: string; version: string | null } {
  if (activity.source === LEGACY_ACTIVITY_SOURCE) {
    return { endpoint: LEGACY_DELETE_ENDPOINT, version: null }
  }
  return { endpoint: CANONICAL_DELETE_ENDPOINT, version: activity.updatedAt ?? null }
}

function reportActivityDeleteProblem(err: unknown, code: string, attributes: Record<string, string>): void {
  try {
    getTelemetryRuntime()?.reportError(err, { module: 'customers', code, attributes })
  } catch (reportingErr) {
    logger.warn('Activity delete problem could not be reported', { code, err: reportingErr })
  }
}

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
 * Legacy-only rows go through the activities adapter, which bridges them before deleting.
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
      reportActivityDeleteProblem(err, 'customers.activity_delete_refresh_failed', { component: logContext })
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
      const target = resolveDeleteTarget(activity)
      const operation = () =>
        withScopedApiRequestHeaders(buildOptimisticLockHeader(target.version), () =>
          apiCallOrThrow(target.endpoint, {
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
        reportActivityDeleteProblem(err, 'customers.activity_delete_failed', {
          component: logContext,
          activityId: activity.id,
        })
        flash(t('customers.activities.actions.deleteError', 'Could not delete activity'), 'error')
      }
    },
    [confirm, logContext, runMutation, t, triggerRefresh],
  )

  return { deleteActivity, ConfirmDialogElement }
}
