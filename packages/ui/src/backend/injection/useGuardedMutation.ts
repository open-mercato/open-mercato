"use client"

import * as React from 'react'
import { useInjectionSpotEvents } from './InjectionSpot'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID, dispatchBackendMutationError, type BackendMutationErrorEventDetail } from './mutationEvents'
import { withScopedApiRequestHeaders } from '../utils/apiCall'
import { surfaceRecordConflict } from '../conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'useGuardedMutation' })

type GuardedMutationContext = Record<string, unknown>

type GuardedMutationRunInput<TResult, TContext extends GuardedMutationContext> = {
  operation: () => Promise<TResult>
  context: TContext
  mutationPayload?: Record<string, unknown>
  onSuccess?: () => void | Promise<void>
}

type UseGuardedMutationOptions = {
  contextId: string
  blockedMessage?: string
  spotId?: string
}

type GuardedMutationExecutor<TContext extends GuardedMutationContext> = <TResult>(
  input: GuardedMutationRunInput<TResult, TContext>,
  retryFormId?: string,
) => Promise<TResult>

export function useGuardedMutation<TContext extends GuardedMutationContext>({
  contextId,
  blockedMessage = 'Save blocked by validation',
  spotId = GLOBAL_MUTATION_INJECTION_SPOT_ID,
}: UseGuardedMutationOptions) {
  const t = useT()
  const { triggerEvent } = useInjectionSpotEvents<TContext, Record<string, unknown>>(spotId)
  const lastMutationRef = React.useRef<BackendMutationErrorEventDetail['retryMutation']>(undefined)
  const executeMutationRef = React.useRef<GuardedMutationExecutor<TContext> | null>(null)

  const emitMutationSaveError = React.useCallback((
    error: unknown,
    retryMutation: NonNullable<BackendMutationErrorEventDetail['retryMutation']>,
    formId: string,
  ) => {
    dispatchBackendMutationError({
      contextId,
      formId,
      error,
      retryMutation,
    })
    // Default UX for OSS optimistic-lock conflicts (spec
    // .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md §3.6): when the
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

  const executeMutation = React.useCallback(async <TResult,>({
    operation,
    context,
    mutationPayload,
    onSuccess,
  }: GuardedMutationRunInput<TResult, TContext>, retryFormId?: string): Promise<TResult> => {
    const payload = mutationPayload ?? {}
    const retryMutation = async (formId?: string): Promise<boolean> => {
      const execute = executeMutationRef.current
      if (!execute) return false
      try {
        await execute({ operation, context, mutationPayload: payload, onSuccess }, formId)
        return true
      } catch {
        return false
      }
    }
    lastMutationRef.current = retryMutation
    const mutationContext = retryFormId ? { ...context, formId: retryFormId } : context
    const formId = retryFormId ?? contextId

    const beforeSave = await triggerEvent('onBeforeSave', payload, mutationContext)
    if (!beforeSave.ok) {
      emitMutationSaveError(beforeSave.details ?? beforeSave, retryMutation, formId)
      throw new Error(beforeSave.message || blockedMessage)
    }

    let result: TResult
    try {
      result =
        beforeSave.requestHeaders && Object.keys(beforeSave.requestHeaders).length > 0
          ? await withScopedApiRequestHeaders(beforeSave.requestHeaders, operation)
          : await operation()

      try {
        await triggerEvent('onAfterSave', payload, mutationContext)
      } catch (error) {
        logger.error('Error in onAfterSave injection event', { err: error })
      }
    } catch (error) {
      emitMutationSaveError(error, retryMutation, formId)
      throw error
    }
    await onSuccess?.()
    return result
  }, [blockedMessage, contextId, emitMutationSaveError, triggerEvent])

  React.useEffect(() => {
    executeMutationRef.current = executeMutation
    return () => { executeMutationRef.current = null }
  }, [executeMutation])

  const runMutation: <TResult>(input: GuardedMutationRunInput<TResult, TContext>) => Promise<TResult> = executeMutation

  const retryLastMutation = React.useCallback(async (): Promise<boolean> => {
    return (await lastMutationRef.current?.()) ?? false
  }, [])

  return {
    runMutation,
    retryLastMutation,
  }
}
