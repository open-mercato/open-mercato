"use client"
import { DataTable } from "@open-mercato/ui/backend/DataTable";
import { RowActions } from "@open-mercato/ui/backend/RowActions";
import { useT } from "@/lib/i18n/context";
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import * as React from 'react'
import type { FilterDef, FilterValues } from "@open-mercato/ui/backend/FilterBar"
import { useMutation } from '@tanstack/react-query'
import { deleteCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud";
import { Button } from "@open-mercato/ui/primitives/button";
import Link from "next/link";

type Row = {
  id: string
  identifier: string
  name: string
  description: string
  category?: string
  default_state: boolean
  fail_mode: 'fail_open' | 'fail_closed'
}

export function FeatureTogglesTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [categoryOptions, setCategoryOptions] = React.useState<Array<{ value: string; label: string }>>([])

  const categoryFilterValue = typeof filterValues.category === 'string' ? filterValues.category.trim() : ''
  const nameFilterValue = typeof filterValues.name === 'string' ? filterValues.name.trim() : ''
  const identifierFilterValue = typeof filterValues.identifier === 'string' ? filterValues.identifier.trim() : ''
  const defaultStateFilterValue = typeof filterValues.defaultState === 'string'
    ? filterValues.defaultState.trim()
    : ''

  const sortField = sorting.length > 0 ? sorting[0].id : 'category'
  const sortDir = sorting.length > 0 && sorting[0].desc ? 'desc' : 'asc'

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    if (categoryFilterValue) params.set('category', categoryFilterValue)
    if (nameFilterValue) params.set('name', nameFilterValue)
    if (identifierFilterValue) params.set('identifier', identifierFilterValue)
    if (defaultStateFilterValue) params.set('defaultState', defaultStateFilterValue)

    params.set('sortField', sortField)
    params.set('sortDir', sortDir)

    return params.toString()
  }, [categoryFilterValue, defaultStateFilterValue, identifierFilterValue, nameFilterValue, sortField, sortDir])

  const handleSortingChange = React.useCallback((newSorting: SortingState) => {
    setSorting(newSorting)
  }, [])

  const { data: featureTogglesData, isLoading } = useQuery({
    queryKey: ['feature_toggles', queryParams],
    queryFn: async () => {
      const call = await apiCall<{ items: Row[]; total: number; totalPages: number; isSuperAdmin?: boolean }>(
        `/api/feature_toggles/global${queryParams ? `?${queryParams}` : ''}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('feature_toggles.list.error.load', 'Failed to load feature toggles'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  React.useEffect(() => {
    const items = featureTogglesData?.items ?? []
    if (!items.length) return
    const existing = new Map(categoryOptions.map((option) => [option.value, option]))
    let updated = false
    items.forEach((item) => {
      const category = typeof item.category === 'string' ? item.category.trim() : ''
      if (!category || existing.has(category)) return
      existing.set(category, { value: category, label: category })
      updated = true
    })
    if (updated) {
      const next = Array.from(existing.values()).sort((a, b) => a.label.localeCompare(b.label))
      setCategoryOptions(next)
    }
  }, [categoryOptions, featureTogglesData?.items])

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
      type: 'select',
      options: categoryOptions,
    },
    {
      id: 'defaultState',
      label: t('feature_toggles.list.filters.defaultState', 'Default state'),
      type: 'select',
      options: [
        { value: 'enabled', label: t('feature_toggles.list.filters.defaultState.enabled', 'Enabled') },
        { value: 'disabled', label: t('feature_toggles.list.filters.defaultState.disabled', 'Disabled') },
      ],
    },
  ], [categoryOptions, t])

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

  const updateFeatureToggleMutation = useMutation({
    mutationFn: async (values: Row) => {
      const payload = {
        id: values.id,
        identifier: values.identifier,
        name: values.name,
        description: values.description,
        category: values.category,
        defaultState: values.default_state,
        failMode: values.fail_mode,
      }
      await updateCrud('feature_toggles/global', payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['feature_toggles'] })
    },
  })

  const onSubmit = React.useCallback(async (values: Row) => {
    await updateFeatureToggleMutation.mutateAsync(values)
  }, [updateFeatureToggleMutation])

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
        accessorKey: 'defaultState',
        header: t('feature_toggles.list.headers.defaultState', 'Default State'),
        enableSorting: true,
        cell: ({ row }) => {
          return (
            <select
              value={row.original.default_state ? 'enabled' : 'disabled'}
              disabled={updateFeatureToggleMutation.isPending}
              onChange={(e) => {
                const state = e.target.value === 'enabled' ? true : false
                onSubmit({
                  ...row.original,
                  default_state: state,
                })
              }}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          )
        },
      },
      {
        accessorKey: 'fail_mode',
        header: t('feature_toggles.list.headers.failMode', 'Fail Mode'),
        enableSorting: true,
      },
    ]
    return base
  }, [])

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
      rowActions={(row) => (
        <RowActions items={[
          { label: t('common.edit', 'Edit'), href: `/backend/feature-toggles/global/${row.id}/edit` },
          { label: t('common.view', 'Overrides'), href: `/backend/feature-toggles/global/${row.id}` },
          { label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
        ]} />
      )}
    />
  )
}
