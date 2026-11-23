"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { useInjectionSpotEvents } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID } from '@open-mercato/ui/backend/injection/mutationEvents'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'

type XeroMutationContext = Record<string, unknown>

type XeroMutationInput<TResult> = {
  operation: () => Promise<TResult>
  context: XeroMutationContext
  mutationPayload?: Record<string, unknown>
}

/**
 * Runs a Xero write through the global backend mutation lifecycle (record locks, injected headers)
 * and, inside it, through the integration detail host's `onBeforeSave` / `onAfterSave` handlers.
 * Only the global lifecycle reports a failure, so each failure is reported once.
 */
export function useXeroMutation(contextId: string, detailSpotId: string | undefined) {
  const t = useT()
  const hostSpotId = detailSpotId && detailSpotId !== GLOBAL_MUTATION_INJECTION_SPOT_ID ? detailSpotId : null
  const { runMutation: runGlobal, retryLastMutation } = useGuardedMutation<XeroMutationContext>({
    contextId,
    blockedMessage: t('sync_xero.tab.writeBlocked'),
  })
  const { triggerEvent: triggerHostEvent } = useInjectionSpotEvents<XeroMutationContext, Record<string, unknown>>(
    hostSpotId ?? GLOBAL_MUTATION_INJECTION_SPOT_ID,
  )

  const runMutation = React.useCallback(
    async <TResult,>({ operation, context, mutationPayload }: XeroMutationInput<TResult>): Promise<TResult> => {
      if (!hostSpotId) return runGlobal({ operation, context, mutationPayload })
      const payload = mutationPayload ?? {}
      return runGlobal({
        operation: async () => {
          const beforeSave = await triggerHostEvent('onBeforeSave', payload, context)
          if (!beforeSave.ok) throw new Error(beforeSave.message || t('sync_xero.tab.writeBlocked'))
          const headers = beforeSave.requestHeaders ?? {}
          const result = Object.keys(headers).length > 0 ? await withScopedApiRequestHeaders(headers, operation) : await operation()
          try {
            await triggerHostEvent('onAfterSave', payload, context)
          } catch (error) {
            getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.host_after_save_failed' })
          }
          return result
        },
        context,
        mutationPayload,
      })
    },
    [hostSpotId, runGlobal, t, triggerHostEvent],
  )

  return { runMutation, retryLastMutation }
}
