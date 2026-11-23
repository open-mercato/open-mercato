"use client"

import * as React from 'react'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID } from '@open-mercato/ui/backend/injection/mutationEvents'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

type XeroMutationContext = Record<string, unknown>

type XeroMutationInput<TResult> = {
  operation: () => Promise<TResult>
  context: XeroMutationContext
  mutationPayload?: Record<string, unknown>
}

/**
 * Runs a Xero write through the global backend mutation lifecycle (record locks, injected headers)
 * and, nested inside it, through the integration detail host's lifecycle.
 */
export function useXeroMutation(contextId: string, detailSpotId: string | undefined) {
  const hostSpotId = detailSpotId && detailSpotId !== GLOBAL_MUTATION_INJECTION_SPOT_ID ? detailSpotId : null
  const globalLifecycle = useGuardedMutation<XeroMutationContext>({ contextId })
  const hostLifecycle = useGuardedMutation<XeroMutationContext>({
    contextId,
    spotId: hostSpotId ?? GLOBAL_MUTATION_INJECTION_SPOT_ID,
  })
  const runGlobal = globalLifecycle.runMutation
  const runHost = hostLifecycle.runMutation

  const runMutation = React.useCallback(
    async <TResult,>({ operation, context, mutationPayload }: XeroMutationInput<TResult>): Promise<TResult> => {
      if (!hostSpotId) return runGlobal({ operation, context, mutationPayload })
      return runGlobal({
        operation: () => runHost({ operation, context, mutationPayload }),
        context,
        mutationPayload,
      })
    },
    [hostSpotId, runGlobal, runHost],
  )

  return { runMutation, retryLastMutation: globalLifecycle.retryLastMutation }
}
