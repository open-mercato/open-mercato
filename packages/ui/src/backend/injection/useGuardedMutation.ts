"use client"

import * as React from 'react'
import { useInjectionSpotEvents } from './InjectionSpot'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID, dispatchBackendMutationError } from './mutationEvents'
import { withScopedApiRequestHeaders } from '../utils/apiCall'
import { surfaceRecordConflict } from '../conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
  const t = useT()
  const { triggerEvent } = useInjectionSpotEvents<TContext, Record<string, unknown>>(spotId)
  const lastMutationRef = React.useRef<StoredMutation<TContext> | null>(null)

  const emitMutationSaveError = React.useCallback((error: unknown) => {
    dispatchBackendMutationError({
      contextId,
      formId: contextId,
      error,
    })
    // Default UX for OSS optimistic-lock conflicts (spec
    // .ai/specs/2026-05-25-oss-optimistic-locking.md §3.6): when the
    // server returns 409 with `code: 'optimistic_lock_conflict'`,
    // surface the conflict on the unified, persistent, error-styled
    // RecordConflictBanner (rendered in AppShell) instead of a transient
    // toast. Callers that have their own handler still see the dispatched
    // event above and can suppress/override by catching the error first.
    try {
      surfaceRecordConflict(error, t)
    } catch {
      // ignore conflict-bar dispatch failures
    }
  }, [contextId, t])

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
