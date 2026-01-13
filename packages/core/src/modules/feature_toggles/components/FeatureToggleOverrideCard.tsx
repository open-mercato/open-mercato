"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { DataLoader, ErrorNotice } from "@open-mercato/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { useT } from "@/lib/i18n/context";
import { CrudForm } from "@open-mercato/ui/backend/CrudForm";
import { createOverrideFieldDefinitions, createOverrideFormGroups } from "./overrideFormConfig";
import { FeatureToggleOverrideResponse } from "../data/validators";


export function FeatureToggleOverrideCard({ toggleId }: { toggleId: string }) {
    const t = useT()
    const queryClient = useQueryClient()
    
    const { data: overrideData, isLoading, error } = useQuery({
        queryKey: ['feature_toggle_override', toggleId],
        queryFn: async () => {
            const call = await apiCall<FeatureToggleOverrideResponse>(`/api/feature_toggles/global/${toggleId}/override`)
            if (!call.ok) {
                await raiseCrudError(call.response, t('feature_toggles.override.error.load', 'Failed to load override'))
            }
            return call.result
        },
        enabled: !!toggleId
    })

    const mutation = useMutation({
        mutationFn: async (input: { toggleId: string; isOverride: boolean; overrideValue?: any; tenantId: string }) => {
            const call = await apiCall<{ ok: boolean }>(
                `/api/feature_toggles/overrides`,
                {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        toggleId: input.toggleId,
                        isOverride: input.isOverride,
                        overrideValue: input.overrideValue,
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

    const fieldDefinitions = createOverrideFieldDefinitions(t)
    const formGroups = createOverrideFormGroups(t)
    const initialValues = overrideData ? {
        isOverride: overrideData.id === '' ? false : true,
        overrideValue: overrideData.value,
        toggleType: overrideData.toggleType,
        tenantId: overrideData.tenantId,
        tenantName: overrideData.tenantName,
    } : {}

    const handleSubmit = async (values: any) => {
        if (!overrideData) return
        await mutation.mutateAsync({
            toggleId,
            isOverride: values.isOverride,
            overrideValue: values.overrideValue,
            tenantId: overrideData.tenantId
        })
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
                            <div className="h-20 w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
                        </div>
                    }
                >
                    {overrideData && (
                        <CrudForm
                            fields={fieldDefinitions}
                            groups={formGroups}
                            initialValues={initialValues}
                            onSubmit={handleSubmit}
                            submitLabel={t('feature_toggles.override.save', 'Save Override')}
                            embedded={true}
                            isLoading={false}
                        />
                    )}
                </DataLoader>
            </CardContent>
        </Card>
    )
}
