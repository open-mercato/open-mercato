"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UseFeatureFlagJsonOptions = {
    id: string
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

export function useFeatureFlagJson<T = unknown>(options: UseFeatureFlagJsonOptions): UseFeatureFlagJsonResult<T> {
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
    })

    const value = query.data?.ok ? query.data.value : null
    const isLoading = query.isLoading

    return {
        value,
        isLoading,
    }
}
