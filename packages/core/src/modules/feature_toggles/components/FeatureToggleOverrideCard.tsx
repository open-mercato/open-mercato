"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label, DataLoader, ErrorNotice } from "@open-mercato/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { useT } from "@/lib/i18n/context";

type OverrideData = {
    id: string
    state: 'enabled' | 'disabled' | 'inherit'
    tenantName: string
    tenantId: string
}

export function FeatureToggleOverrideCard({ toggleId }: { toggleId: string }) {
    const t = useT()
    const queryClient = useQueryClient()

    const { data: overrideData, isLoading, error } = useQuery({
        queryKey: ['feature_toggle_override', toggleId],
        queryFn: async () => {
            const call = await apiCall<OverrideData>(`/api/feature_toggles/global/${toggleId}/override`)
            if (!call.ok) {
                await raiseCrudError(call.response, t('feature_toggles.override.error.load', 'Failed to load override'))
            }
            return call.result
        },
        enabled: !!toggleId
    })

    const mutation = useMutation({
        mutationFn: async (input: { toggleId: string; state: OverrideData['state']; tenantId: string }) => {
            const call = await apiCall<{ ok: boolean }>(
                `/api/feature_toggles/overrides`,
                {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        toggleId: input.toggleId,
                        state: input.state,
                        tenantId: input.tenantId
                    }),
                },
            )
            if (!call.ok) {
                await raiseCrudError(call.response, t('feature_toggles.overrides.error.update', 'Failed to update override'))
            }
            return call.result
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: ['feature_toggle_override', toggleId] })
            await queryClient.invalidateQueries({ queryKey: ['feature_toggle_overrides'] })
        },
    })

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{t('feature_toggles.override.title', 'Override')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <ErrorNotice message={error.message} />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('feature_toggles.override.title', 'Override')}</CardTitle>
                {overrideData ? (
                    <CardDescription>{t('feature_toggles.override.tenant', 'Tenant: {{name}}', { name: overrideData.tenantName })}</CardDescription>
                ) : <CardDescription className="h-5 w-48 animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-md" />}
            </CardHeader>
            <CardContent>
                <DataLoader
                    isLoading={isLoading}
                    showSkeleton
                    skeletonComponent={
                        <div className="space-y-4">
                            <div className="h-9 w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
                        </div>
                    }
                >
                    {overrideData && (
                        <div className="grid gap-4">
                            <div className="flex flex-col gap-2">
                                <Label>
                                    {t('feature_toggles.override.state_label', 'Override state')}
                                </Label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                    value={overrideData.state}
                                    disabled={mutation.isPending}
                                    onChange={(e) => {
                                        const state = e.target.value as OverrideData['state']
                                        mutation.mutate({
                                            toggleId: toggleId,
                                            state,
                                            tenantId: overrideData.tenantId
                                        })
                                    }}
                                >
                                    <option value="inherit">{t('feature_toggles.list.filters.overrideState.inherit', 'Inherit')}</option>
                                    <option value="enabled">{t('feature_toggles.list.filters.overrideState.enabled', 'Enabled')}</option>
                                    <option value="disabled">{t('feature_toggles.list.filters.overrideState.disabled', 'Disabled')}</option>
                                </select>
                            </div>
                        </div>
                    )}
                </DataLoader>
            </CardContent>
        </Card>
    )
}
