import * as React from 'react'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DealDetailPayload, GuardedMutationRunner } from './types'

type InjectionContext = {
  formId: string
  dealId: string | null | undefined
  resourceKind: string
  resourceId: string | undefined
  data: DealDetailPayload | null
  retryLastMutation: () => Promise<boolean>
}

type UseDealMutationContextOptions = {
  currentDealId: string | null
  fallbackId: string
  data: DealDetailPayload | null
}

type UseDealMutationContextResult = {
  mutationContextId: string
  injectionContext: InjectionContext
  runMutationWithContext: GuardedMutationRunner
  retryLastMutation: () => Promise<boolean>
}

export function useDealMutationContext({
  currentDealId,
  fallbackId,
  data,
}: UseDealMutationContextOptions): UseDealMutationContextResult {
  const t = useT()
  const mutationContextId = React.useMemo(
    () =>
      currentDealId
        ? `customer-deal:${currentDealId}`
        : `customer-deal:${fallbackId || 'pending'}`,
    [currentDealId, fallbackId],
  )

  const { runMutation, retryLastMutation } = useGuardedMutation<InjectionContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const injectionContext = React.useMemo<InjectionContext>(
    () => ({
      formId: mutationContextId,
      dealId: currentDealId,
      resourceKind: 'customers.deal',
      resourceId: currentDealId ?? undefined,
      data,
      retryLastMutation,
    }),
    [currentDealId, data, mutationContextId, retryLastMutation],
  )

  const runMutationWithContext = React.useCallback<GuardedMutationRunner>(
    async (operation, mutationPayload) => {
      return runMutation({
        operation,
        mutationPayload,
        context: injectionContext,
      })
    },
    [injectionContext, runMutation],
  )

  return {
    mutationContextId,
    injectionContext,
    runMutationWithContext,
    retryLastMutation,
  }
}
