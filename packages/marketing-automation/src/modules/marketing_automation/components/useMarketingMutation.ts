'use client'
import * as React from 'react'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type MarketingMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

/**
 * Every write on a marketing screen, through the platform's mutation guard.
 *
 * `AGENTS.md` makes this mandatory for any backend page that cannot use `CrudForm`, and none of the fifteen
 * screens here can — they are a canvas, a side-panel editor and a settings form, not record CRUD. Going
 * around it means the global mutation injections do not run: record locks, the conflict and merge dialogs,
 * approval hooks, and whatever guard the platform adds next. The writes worked, which is exactly why nobody
 * noticed; a guard added later would simply not have covered marketing.
 *
 * One hook for the module rather than twenty-five lines repeated in nine files, and the context carries
 * `retryLastMutation` as the rule requires — it is what lets the conflict banner offer "try again" after the
 * operator has looked at the newer version.
 *
 * The conflict itself is NOT surfaced here. `useGuardedMutation` already calls `surfaceRecordConflict` on
 * every failure, so a page that also called it would raise the same banner twice; pages decide only whether
 * to add their own message on top, using `extractOptimisticLockConflict` as the predicate.
 */
export function useMarketingMutation(resourceKind: string, resourceId?: string) {
  const t = useT()
  const contextId = `marketing_automation.${resourceKind}`
  const { runMutation, retryLastMutation } = useGuardedMutation<MarketingMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const context = React.useMemo<MarketingMutationContext>(
    () => ({ formId: contextId, resourceKind, resourceId, retryLastMutation }),
    [contextId, resourceKind, resourceId, retryLastMutation],
  )

  return React.useCallback(
    <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> =>
      runMutation({ operation, context, mutationPayload }),
    [context, runMutation],
  )
}
