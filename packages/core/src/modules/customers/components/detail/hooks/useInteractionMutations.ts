'use client'

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

export type GuardedMutationRunner = <T>(
  runner: () => Promise<T>,
  payload?: Record<string, unknown>,
) => Promise<T>

export type UseInteractionMutationsOptions = {
  runMutationWithContext: GuardedMutationRunner
  onAfterChange?: () => void | Promise<void>
  /** Log prefix used when a mutation throws, e.g. "customers.people-v2". */
  logContext?: string
}

export type UseInteractionMutationsResult = {
  completeInteraction: (interactionId: string, updatedAt?: string | null) => Promise<void>
  cancelInteraction: (interactionId: string, updatedAt?: string | null) => Promise<void>
}

/**
 * Shared interaction mutation handlers for deal and entity detail pages.
 * Centralizes the complete/cancel activity logic so every detail page
 * uses the same guarded-mutation + flash + refresh contract.
 */
export function useInteractionMutations({
  runMutationWithContext,
  onAfterChange,
  logContext = 'customers.interactionMutations',
}: UseInteractionMutationsOptions): UseInteractionMutationsResult {
  const t = useT()

  const triggerRefresh = React.useCallback(async () => {
    if (!onAfterChange) return
    try {
      await onAfterChange()
    } catch (err) {
      logger.warn('onAfterChange threw', { component: logContext, err })
    }
  }, [logContext, onAfterChange])

  const completeInteraction = React.useCallback(
    async (interactionId: string, updatedAt?: string | null) => {
      try {
        await runMutationWithContext(
          () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(updatedAt ?? null),
              () => apiCallOrThrow('/api/customers/interactions/complete', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: interactionId, occurredAt: new Date().toISOString() }),
              }),
            ),
          { id: interactionId, status: 'done', operation: 'completeActivity' },
        )
        flash(t('customers.timeline.planned.completed', 'Activity completed'), 'success')
        await triggerRefresh()
      } catch (err) {
        if (surfaceRecordConflict(err, t)) { await triggerRefresh(); return }
        logger.warn('Complete interaction failed', { component: logContext, interactionId, err })
        flash(t('customers.timeline.planned.error', 'Failed to complete activity'), 'error')
      }
    },
    [logContext, runMutationWithContext, t, triggerRefresh],
  )

  const cancelInteraction = React.useCallback(
    async (interactionId: string, updatedAt?: string | null) => {
      try {
        await runMutationWithContext(
          () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(updatedAt ?? null),
              () => apiCallOrThrow('/api/customers/interactions', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: interactionId, status: 'canceled' }),
              }),
            ),
          { id: interactionId, status: 'canceled', operation: 'cancelActivity' },
        )
        flash(t('customers.timeline.planned.canceled', 'Activity canceled'), 'success')
        await triggerRefresh()
      } catch (err) {
        if (surfaceRecordConflict(err, t)) { await triggerRefresh(); return }
        logger.warn('Cancel interaction failed', { component: logContext, interactionId, err })
        flash(t('customers.timeline.planned.cancelError', 'Failed to cancel activity'), 'error')
      }
    },
    [logContext, runMutationWithContext, t, triggerRefresh],
  )

  return { completeInteraction, cancelInteraction }
}
