"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UseFeatureFlagNumberOptions = {
    id: string
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
    })

    const value = query.data?.ok ? query.data.value : null
    const isLoading = query.isLoading

    return {
        value,
        isLoading,
    }
}
