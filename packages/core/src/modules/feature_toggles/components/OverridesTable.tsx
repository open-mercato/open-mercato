"use client"

import { DataTable } from "@open-mercato/ui/backend/DataTable";
import { useQuery } from "@tanstack/react-query";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { ColumnDef, SortingState } from "@tanstack/react-table";
import * as React from 'react'
import type { FilterDef, FilterValues } from "@open-mercato/ui/backend/FilterBar"

type Row = {
    id: string
    toggleId: string
    overrideState: 'enabled' | 'disabled' | 'inherit'
    tenantName: string
    tenantId: string
    identifier: string
    name: string
    category: string
    defaultState: boolean
}

export default function OverridesTable() {
    const [filterValues, setFilterValues] = React.useState<FilterValues>({})
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [pagination, setPagination] = React.useState({ page: 1, pageSize: 25 })

    const t = useT()
    const queryClient = useQueryClient()

    const sortField = sorting.length > 0 ? sorting[0].id : undefined
    const sortDir = sorting.length > 0 && sorting[0].desc ? 'desc' : 'asc'

    const queryParams = React.useMemo(() => {
        const params = new URLSearchParams()
        Object.entries(filterValues).forEach(([key, value]) => {
            params.set(key, value as string)
        })
        if (sortField) params.set('sortField', sortField)
        if (sorting.length > 0) params.set('sortDir', sortDir)

        params.set('page', pagination.page.toString())
        params.set('pageSize', pagination.pageSize.toString())

        return params.toString()
    }, [filterValues, sortField, sortDir, pagination])

    const { data: featureTogglesData, isLoading, error } = useQuery({
        queryKey: ['feature_toggle_overrides', queryParams],
        queryFn: async () => {
            const call = await apiCall<{
                items: Row[];
                total: number;
                totalPages: number;
                page: number;
                pageSize: number;
                isSuperAdmin?: boolean
            }>(`/api/feature_toggles/overrides?${queryParams}`)
            if (!call.ok) {
                await raiseCrudError(call.response, t('feature_toggles.list.error.load', 'Failed to load feature toggles'))
            }
            return call.result ?? {
                items: [],
                total: 0,
                totalPages: 1,
                page: 1,
                pageSize: 25
            }
        },
    })

    const mutation = useMutation({
        mutationFn: async (input: { toggleId: string; state: Row['overrideState'] }) => {
            const call = await apiCall<{ ok: boolean }>(
                `/api/feature_toggles/overrides`,
                {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        toggleId: input.toggleId,
                        state: input.state,
                    }),
                },
            )
            if (!call.ok) {
                await raiseCrudError(call.response, t('feature_toggles.overrides.error.update', 'Failed to update override'))
            }
            return call.result
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: ['feature_toggle_overrides'] })
        },
    })

    const handleFiltersApply = React.useCallback((values: FilterValues) => {
        setFilterValues(values)
    }, [])

    const handleFiltersClear = React.useCallback(() => {
        setFilterValues({})
    }, [])

    const handleSortingChange = React.useCallback((newSorting: SortingState) => {
        setSorting(newSorting)
    }, [])

    const handlePageChange = React.useCallback((page: number) => {
        setPagination(prev => ({ ...prev, page }))
    }, [])

    const handleRefresh = React.useCallback(() => {
        void queryClient.refetchQueries({ queryKey: ['feature_toggle_overrides'] })
    }, [queryClient])

    const columns = React.useMemo<ColumnDef<Row>[]>(() => {
        return [
            {
                accessorKey: 'tenantName',
                header: t('feature_toggles.overrides.headers.tenant', 'Tenant'),
                enableSorting: true
            },
            {
                accessorKey: 'identifier',
                header: t('feature_toggles.overrides.headers.identifier', 'Identifier'),
                enableSorting: true
            },
            {
                accessorKey: 'name',
                header: t('feature_toggles.overrides.headers.name', 'Name'),
                enableSorting: true
            },
            {
                accessorKey: 'category',
                header: t('feature_toggles.overrides.headers.category', 'Category'),
                enableSorting: true
            },
            {
                accessorKey: 'defaultState',
                header: t('feature_toggles.overrides.headers.defaultState', 'Default State'),
                cell: ({ row }) => {
                    return (
                        <span>
                            {row.original.defaultState ? t('feature_toggles.list.headers.enabled', 'Enabled') : t('feature_toggles.list.filters.defaultState.disabled', 'Disabled')}
                        </span>
                    )
                },
                enableSorting: true
            },
            {
                accessorKey: 'overrideState',
                header: t('feature_toggles.overrides.headers.overrideState', 'Override State'),
                enableSorting: true,
                cell: ({ row }) => {
                    const isUpdating =
                        mutation.isPending
                        && mutation.variables?.toggleId === row.original.toggleId

                    return (
                        <select
                            value={row.original.overrideState}
                            disabled={isUpdating}
                            onChange={(e) => {
                                const state = e.target.value as Row['overrideState']
                                mutation.mutate({
                                    toggleId: row.original.toggleId,
                                    state,
                                })
                            }}
                        >
                            <option value="inherit">Inherit</option>
                            <option value="enabled">Enabled</option>
                            <option value="disabled">Disabled</option>
                        </select>
                    )
                },
            },
        ]
    }, [mutation])


    const filters = React.useMemo<FilterDef[]>(() => [
        {
            id: 'identifier',
            label: t('feature_toggles.list.filters.identifier', 'Identifier'),
            type: 'text',
        },
        {
            id: 'name',
            label: t('feature_toggles.list.filters.name', 'Name'),
            type: 'text',
        },
        {
            id: 'category',
            label: t('feature_toggles.list.filters.category', 'Category'),
            type: 'text',
        },
        {
            id: 'defaultState',
            label: t('feature_toggles.list.filters.defaultState', 'Default State'),
            type: 'select',
            options: [
                { value: 'true', label: t('feature_toggles.list.filters.defaultState.enabled', 'Enabled') },
                { value: 'false', label: t('feature_toggles.list.filters.defaultState.disabled', 'Disabled') },
            ],
        },
        {
            id: 'overrideState',
            label: t('feature_toggles.list.filters.overrideState', 'Override State'),
            type: 'select',
            options: [
                { value: 'inherit', label: t('feature_toggles.list.filters.overrideState.inherit', 'Inherit') },
                { value: 'enabled', label: t('feature_toggles.list.filters.overrideState.enabled', 'Enabled') },
                { value: 'disabled', label: t('feature_toggles.list.filters.overrideState.disabled', 'Disabled') },
            ],
        },
    ], [t])

    return (
        <DataTable
            title={t('feature_toggles.overrides.help.title', 'Feature Toggle Overrides')}
            columns={columns}
            filters={filters}
            filterValues={filterValues}
            onFiltersApply={handleFiltersApply}
            onFiltersClear={handleFiltersClear}
            data={featureTogglesData?.items ?? []}
            isLoading={isLoading}
            sorting={sorting}
            onSortingChange={handleSortingChange}
            sortable={true}
            pagination={{
                page: featureTogglesData?.page ?? 1,
                pageSize: featureTogglesData?.pageSize ?? 25,
                total: featureTogglesData?.total ?? 0,
                totalPages: featureTogglesData?.totalPages ?? 1,
                onPageChange: handlePageChange,
            }}
            refreshButton={{
                label: t('feature_toggles.list.table.refresh', 'Refresh'),
                onRefresh: handleRefresh,
                isRefreshing: isLoading,
            }}
            error={error ? error.message : undefined}
        />
    )
}
