"use client"

import * as React from 'react'
import { useInjectionSpotEvents } from './InjectionSpot'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID, dispatchBackendMutationError } from './mutationEvents'
import { withScopedApiRequestHeaders } from '../utils/apiCall'

type GuardedMutationContext = Record<string, unknown>

type GuardedMutationRunInput<TResult, TContext extends GuardedMutationContext> = {
  operation: () => Promise<TResult>
  context: TContext
  mutationPayload?: Record<string, unknown>
}

type UseGuardedMutationOptions = {
  contextId: string
  blockedMessage?: string
  spotId?: string
}

type StoredMutation<TContext extends GuardedMutationContext> = {
  operation: () => Promise<unknown>
  context: TContext
  mutationPayload: Record<string, unknown>
}

export function useGuardedMutation<TContext extends GuardedMutationContext>({
  contextId,
  blockedMessage = 'Save blocked by validation',
  spotId = GLOBAL_MUTATION_INJECTION_SPOT_ID,
}: UseGuardedMutationOptions) {
  const { triggerEvent } = useInjectionSpotEvents<TContext, Record<string, unknown>>(spotId)
  const lastMutationRef = React.useRef<StoredMutation<TContext> | null>(null)

  const emitMutationSaveError = React.useCallback((error: unknown) => {
    dispatchBackendMutationError({
      contextId,
      formId: contextId,
      error,
    })
  }, [contextId])

  const runMutation = React.useCallback(async <TResult,>({
    operation,
    context,
    mutationPayload,
  }: GuardedMutationRunInput<TResult, TContext>): Promise<TResult> => {
    const payload = mutationPayload ?? {}
    lastMutationRef.current = {
      operation: operation as () => Promise<unknown>,
      context,
      mutationPayload: payload,
    }

    const beforeSave = await triggerEvent('onBeforeSave', payload, context)
    if (!beforeSave.ok) {
      emitMutationSaveError(beforeSave.details ?? beforeSave)
      throw new Error(beforeSave.message || blockedMessage)
    }

    try {
      const result =
        beforeSave.requestHeaders && Object.keys(beforeSave.requestHeaders).length > 0
          ? await withScopedApiRequestHeaders(beforeSave.requestHeaders, operation)
          : await operation()

      try {
        await triggerEvent('onAfterSave', payload, context)
      } catch (error) {
        console.error('[useGuardedMutation] Error in onAfterSave injection event:', error)
      }

      return result
    } catch (error) {
      emitMutationSaveError(error)
      throw error
    }
  }, [blockedMessage, emitMutationSaveError, triggerEvent])

  const retryLastMutation = React.useCallback(async (): Promise<boolean> => {
    const lastMutation = lastMutationRef.current
    if (!lastMutation) return false

    try {
      await runMutation({
        operation: lastMutation.operation,
        context: lastMutation.context,
        mutationPayload: lastMutation.mutationPayload,
      })
      return true
    } catch {
      return false
    }
  }, [runMutation])

  return {
    runMutation,
    retryLastMutation,
  }
}
