'use client'

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
  completeInteraction: (interactionId: string) => Promise<void>
  cancelInteraction: (interactionId: string) => Promise<void>
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
      console.warn(`[${logContext}] onAfterChange threw`, err)
    }
  }, [logContext, onAfterChange])

  const completeInteraction = React.useCallback(
    async (interactionId: string) => {
      try {
        await runMutationWithContext(
          () =>
            apiCallOrThrow('/api/customers/interactions/complete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: interactionId, occurredAt: new Date().toISOString() }),
            }),
          { id: interactionId, status: 'done', operation: 'completeActivity' },
        )
        flash(t('customers.timeline.planned.completed', 'Activity completed'), 'success')
        await triggerRefresh()
      } catch (err) {
        console.warn(`[${logContext}] complete interaction failed`, interactionId, err)
        flash(t('customers.timeline.planned.error', 'Failed to complete activity'), 'error')
      }
    },
    [logContext, runMutationWithContext, t, triggerRefresh],
  )

  const cancelInteraction = React.useCallback(
    async (interactionId: string) => {
      try {
        await runMutationWithContext(
          () =>
            apiCallOrThrow('/api/customers/interactions', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: interactionId, status: 'canceled' }),
            }),
          { id: interactionId, status: 'canceled', operation: 'cancelActivity' },
        )
        flash(t('customers.timeline.planned.canceled', 'Activity canceled'), 'success')
        await triggerRefresh()
      } catch (err) {
        console.warn(`[${logContext}] cancel interaction failed`, interactionId, err)
        flash(t('customers.timeline.planned.cancelError', 'Failed to cancel activity'), 'error')
      }
    },
    [logContext, runMutationWithContext, t, triggerRefresh],
  )

  return { completeInteraction, cancelInteraction }
}
