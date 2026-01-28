"use client"
import { DataTable } from "@open-mercato/ui/backend/DataTable";
import { RowActions } from "@open-mercato/ui/backend/RowActions";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import * as React from 'react'
import type { FilterDef, FilterValues } from "@open-mercato/ui/backend/FilterBar"
import { useMutation } from '@tanstack/react-query'
import { deleteCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud";
import { Button } from "@open-mercato/ui/primitives/button";
import { Badge } from "@open-mercato/ui/primitives/badge";
import Link from "next/link";
import { FeatureToggleType } from "../data/entities";

type Row = {
  id: string
  identifier: string
  name: string
  description: string
  category?: string
  type: FeatureToggleType
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'muted'

export function FeatureTogglesTable() {
  const t = useT()
  const queryClient = useQueryClient()

  const featureToggleTypeLabelMap = React.useMemo(() => new Map<FeatureToggleType, { label: string; variant: BadgeVariant }>([
    ['boolean', { label: t('feature_toggles.types.boolean', 'Boolean'), variant: 'default' }],
    ['string', { label: t('feature_toggles.types.string', 'String'), variant: 'secondary' }],
    ['number', { label: t('feature_toggles.types.number', 'Number'), variant: 'outline' }],
    ['json', { label: t('feature_toggles.types.json', 'JSON'), variant: 'destructive' }],
  ]), [t])

  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({ page: 1, pageSize: 25 })

  const categoryFilterValue = typeof filterValues.category === 'string' ? filterValues.category.trim() : ''
  const nameFilterValue = typeof filterValues.name === 'string' ? filterValues.name.trim() : ''
  const identifierFilterValue = typeof filterValues.identifier === 'string' ? filterValues.identifier.trim() : ''
  const typeFilterValue = typeof filterValues.type === 'string' ? filterValues.type.trim() : ''
  const sortField = sorting.length > 0 ? sorting[0].id : 'category'
  const sortDir = sorting.length > 0 && sorting[0].desc ? 'desc' : 'asc'

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    if (categoryFilterValue) params.set('category', categoryFilterValue)
    if (nameFilterValue) params.set('name', nameFilterValue)
    if (identifierFilterValue) params.set('identifier', identifierFilterValue)
    if (typeFilterValue) params.set('type', typeFilterValue)

    params.set('sortField', sortField)
    params.set('sortDir', sortDir)

    params.set('page', pagination.page.toString())
    params.set('pageSize', pagination.pageSize.toString())

    return params.toString()
  }, [categoryFilterValue, identifierFilterValue, nameFilterValue, sortField, sortDir, typeFilterValue, pagination])

  const handleSortingChange = React.useCallback((newSorting: SortingState) => {
    setSorting(newSorting)
  }, [])

  const handlePageChange = React.useCallback((page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }, [])

  const { data: featureTogglesData, isLoading } = useQuery({
    queryKey: ['feature_toggles', queryParams],
    queryFn: async () => {
      const call = await apiCall<{ items: Row[]; total: number; totalPages: number; page: number; pageSize: number; isSuperAdmin?: boolean }>(
        `/api/feature_toggles/global${queryParams ? `?${queryParams}` : ''}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('feature_toggles.list.error.load', 'Failed to load feature toggles'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1, page: 1, pageSize: 25 }
    },
  })

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
      id: 'type',
      label: t('feature_toggles.list.filters.type', 'Type'),
      type: 'select',
      options: [
        { label: t('feature_toggles.types.boolean', 'Boolean'), value: 'boolean' },
        { label: t('feature_toggles.types.string', 'String'), value: 'string' },
        { label: t('feature_toggles.types.number', 'Number'), value: 'number' },
        { label: t('feature_toggles.types.json', 'JSON'), value: 'json' },
      ],
    },
  ], [t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
  }, [])

  const deleteFeatureToggleMutation = useMutation({
    mutationFn: async (row: Row) => {
      await deleteCrud('feature_toggles/global', row.id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['feature_toggles'] })
    },
  })

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(t('feature_toggles.list.confirmDelete', 'Delete feature toggle "{identifier}"?', { identifier: row.identifier }))) return
    await deleteFeatureToggleMutation.mutateAsync(row)
  }, [deleteFeatureToggleMutation, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    const base: ColumnDef<Row>[] = [
      {
        accessorKey: 'category',
        header: t('feature_toggles.list.headers.category', 'Category'),
        enableSorting: true,
        cell: ({ row }) => {
          return row.original.category || '-'
        },
      },
      {
        accessorKey: 'identifier',
        header: t('feature_toggles.list.headers.identifier', 'Identifier'),
        enableSorting: true
      },
      {
        accessorKey: 'name',
        header: t('feature_toggles.list.headers.name', 'Name'),
        enableSorting: true
      },
      {
        accessorKey: 'type',
        header: t('feature_toggles.list.headers.type', 'Type'),
        enableSorting: true,
        cell: ({ row }) => {
          const typeInfo = featureToggleTypeLabelMap.get(row.original.type)
          if (!typeInfo) return '-'

          return (
            <Badge variant={typeInfo.variant}>
              {typeInfo.label}
            </Badge>
          )
        },
      },
    ]
    return base
  }, [t, featureToggleTypeLabelMap])

  return (
    <DataTable
      title={t('feature_toggles.global.help.title', 'Feature Toggles')}
      disableRowClick
      actions={
        <Button asChild>
          <Link href="/backend/feature-toggles/global/create">
            {t('common.create', 'Create')}
          </Link>
        </Button>
      }
      columns={columns}
      data={featureTogglesData?.items ?? []}
      isLoading={isLoading}
      filters={filters}
      filterValues={filterValues}
      onFiltersApply={handleFiltersApply}
      onFiltersClear={handleFiltersClear}
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
      rowActions={(row) => (
        <RowActions items={[
          { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/feature-toggles/global/${row.id}/edit` },
          { id: 'view', label: t('common.view', 'Overrides'), href: `/backend/feature-toggles/global/${row.id}` },
          { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
        ]} />
      )}
    />
  )
}
