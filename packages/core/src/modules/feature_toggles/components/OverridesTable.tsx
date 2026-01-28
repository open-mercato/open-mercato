"use client"

import { DataTable } from "@open-mercato/ui/backend/DataTable";
import { useQuery } from "@tanstack/react-query";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { useQueryClient } from "@tanstack/react-query";
import { ColumnDef, SortingState } from "@tanstack/react-table";
import * as React from 'react'
import type { FilterDef, FilterValues } from "@open-mercato/ui/backend/FilterBar"
import { RowActions } from "@open-mercato/ui/backend/RowActions";
import { OverrideListResponse } from "../data/validators";


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
                items: OverrideListResponse[];
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

    const columns = React.useMemo<ColumnDef<OverrideListResponse>[]>(() => {
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
                accessorKey: 'isOverride',
                header: t('feature_toggles.overrides.headers.overrideState', 'Override'),
                enableSorting: false,
                cell: ({ row }) => {
                    return row.original.isOverride ? t('feature_toggles.overrides.headers.isOverride.true', 'Yes') : t('feature_toggles.overrides.headers.isOverride.false', 'No')
                },
            },
        ]
    }, [])


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
        }
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
            rowActions={(row) => (
                <RowActions items={[
                    { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/feature-toggles/global/${row.toggleId}` },
                ]} />
            )}
            error={error ? error.message : undefined}
        />
    )
}
