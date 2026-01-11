"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UseFeatureFlagOptions = {
  id: string
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
  })

  const enabled = query.data?.ok ? query.data.value : false
  const isLoading = query.isLoading

  return {
    enabled,
    isLoading,
  }
}
