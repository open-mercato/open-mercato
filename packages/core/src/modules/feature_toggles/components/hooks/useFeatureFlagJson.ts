"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { FEATURE_FLAG_STALE_TIME_MS } from './staleTime'

export type UseFeatureFlagJsonOptions<T = unknown> = {
    id: string
    /**
     * Value used while the check is in flight and whenever the toggle cannot be
     * resolved (undefined toggle, type mismatch, network or permission failure).
     * Defaults to `null`.
     */
    defaultValue?: T | null
}

export type UseFeatureFlagJsonResult<T = unknown> = {
    value: T | null
    isLoading: boolean
}

type Result<T> = {
    ok: true
    value: T
} | {
    ok: false
    error: unknown
}

export function useFeatureFlagJson<T = unknown>(options: UseFeatureFlagJsonOptions<T>): UseFeatureFlagJsonResult<T> {
    const defaultValue = options.defaultValue ?? null
    const query = useQuery({
        queryKey: ['featureToggles', 'check', 'json', options?.id],
        queryFn: async () => {
            const params = new URLSearchParams({
                identifier: options.id,
            })

            const result = await readApiResultOrThrow<Result<T>>(
                `/api/feature_toggles/check/json?${params.toString()}`,
                undefined,
                { errorMessage: 'Failed to check feature flag.' },
            )

            return result
        },
        enabled: !!options.id,
        staleTime: FEATURE_FLAG_STALE_TIME_MS,
    })

    const value = query.data?.ok ? query.data.value : defaultValue
    const isLoading = query.isLoading

    return {
        value,
        isLoading,
    }
}
