"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { FEATURE_FLAG_STALE_TIME_MS } from './staleTime'

export type UseFeatureFlagOptions = {
  id: string
  /**
   * Value used while the check is in flight and whenever the toggle cannot be
   * resolved (undefined toggle, type mismatch, network or permission failure).
   *
   * Defaults to `false` so an unresolved toggle keeps a feature switched off.
   * Pass `true` for toggles that hide existing UI — there a failed check must
   * not make the feature disappear.
   */
  defaultValue?: boolean
}

export type UseFeatureFlagResult = {
  enabled: boolean
  isLoading: boolean
}

type Result<T> = {
  ok: true
  value: T
} | {
  ok: false
  error: unknown
}

export function useFeatureFlagBoolean(options: UseFeatureFlagOptions): UseFeatureFlagResult {
  const defaultValue = options.defaultValue ?? false
  const query = useQuery({
    queryKey: ['featureToggles', 'check', options?.id],
    queryFn: async () => {
      const params = new URLSearchParams({
        identifier: options.id,
      })

      const result = await readApiResultOrThrow<Result<boolean>>(
        `/api/feature_toggles/check/boolean?${params.toString()}`,
        undefined,
        { errorMessage: 'Failed to check feature flag.' },
      )

      return result
    },
    enabled: !!options.id,
    staleTime: FEATURE_FLAG_STALE_TIME_MS,
  })

  const enabled = query.data?.ok ? query.data.value : defaultValue
  const isLoading = query.isLoading

  return {
    enabled,
    isLoading,
  }
}
