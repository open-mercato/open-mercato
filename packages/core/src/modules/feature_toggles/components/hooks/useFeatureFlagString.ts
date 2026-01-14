"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UseFeatureFlagStringOptions = {
    id: string
}

export type UseFeatureFlagStringResult = {
    value: string | null
    isLoading: boolean
}

type Result<T> = {
    ok: true
    value: T
} | {
    ok: false
    error: unknown
}

export function useFeatureFlagString(options: UseFeatureFlagStringOptions): UseFeatureFlagStringResult {
    const query = useQuery({
        queryKey: ['featureToggles', 'check', 'string', options?.id],
        queryFn: async () => {
            const params = new URLSearchParams({
                identifier: options.id,
            })

            const result = await readApiResultOrThrow<Result<string>>(
                `/api/feature_toggles/check/string?${params.toString()}`,
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
