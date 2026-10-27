"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { FEATURE_FLAG_STALE_TIME_MS } from './staleTime'

export type UseFeatureFlagNumberOptions = {
    id: string
    /**
     * Value used while the check is in flight and whenever the toggle cannot be
     * resolved (undefined toggle, type mismatch, network or permission failure).
     * Defaults to `null`.
     */
    defaultValue?: number | null
}

export type UseFeatureFlagNumberResult = {
    value: number | null
    isLoading: boolean
}

type Result<T> = {
    ok: true
    value: T
} | {
    ok: false
    error: unknown
}

export function useFeatureFlagNumber(options: UseFeatureFlagNumberOptions): UseFeatureFlagNumberResult {
    const defaultValue = options.defaultValue ?? null
    const query = useQuery({
        queryKey: ['featureToggles', 'check', 'number', options?.id],
        queryFn: async () => {
            const params = new URLSearchParams({
                identifier: options.id,
            })

            const result = await readApiResultOrThrow<Result<number>>(
                `/api/feature_toggles/check/number?${params.toString()}`,
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
