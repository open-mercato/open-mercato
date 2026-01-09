"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type ContractorRow = {
  id: string
  name: string
  shortName?: string | null
  code?: string | null
  taxId?: string | null
  legalName?: string | null
  isActive: boolean
  createdAt?: string
  roles?: Array<{ code: string; name: string; color?: string | null }>
  primaryContactName?: string | null
  primaryAddressCity?: string | null
  primaryAddressCountry?: string | null
}

type ContractorsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function mapApiItem(item: Record<string, unknown>): ContractorRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    shortName: typeof item.shortName === 'string' ? item.shortName : null,
    code: typeof item.code === 'string' ? item.code : null,
    taxId: typeof item.taxId === 'string' ? item.taxId : null,
    legalName: typeof item.legalName === 'string' ? item.legalName : null,
    isActive: item.isActive === true,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    roles: Array.isArray(item.roles) ? item.roles as ContractorRow['roles'] : [],
    primaryContactName: typeof item.primaryContactName === 'string' ? item.primaryContactName : null,
    primaryAddressCity: typeof item.primaryAddressCity === 'string' ? item.primaryAddressCity : null,
    primaryAddressCountry: typeof item.primaryAddressCountry === 'string' ? item.primaryAddressCountry : null,
  }
}

export default function ContractorsPage() {
  const [rows, setRows] = React.useState<ContractorRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [createForm, setCreateForm] = React.useState({ name: '', code: '', taxId: '', legalName: '' })
  const [isCreating, setIsCreating] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const router = useRouter()

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'isActive',
      label: t('contractors.list.filters.isActive', 'Status'),
      type: 'select',
      options: [
        { value: 'true', label: t('contractors.list.filters.active', 'Active') },
        { value: 'false', label: t('contractors.list.filters.inactive', 'Inactive') },
      ],
    },
  ], [t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    const isActive = filterValues.isActive
    if (typeof isActive === 'string') {
      params.set('isActive', isActive)
    }
    return params.toString()
  }, [filterValues, page, pageSize, search])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const call = await apiCall<ContractorsResponse>(`/api/contractors/contractors?${queryParams}`)
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('contractors.list.error.load', 'Failed to load contractors')
          flash(message, 'error')
          return
        }
        const payload = call.result ?? {}
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is ContractorRow => !!row))
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('contractors.list.error.load', 'Failed to load contractors')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (contractor: ContractorRow) => {
    if (!contractor?.id) return
    const name = contractor.name || t('contractors.list.deleteFallbackName', 'this contractor')
    const confirmed = window.confirm(t('contractors.list.deleteConfirm', 'Are you sure you want to delete {{name}}?', { name }))
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/contractors/contractors?id=${encodeURIComponent(contractor.id)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        },
        { errorMessage: t('contractors.list.deleteError', 'Failed to delete contractor') },
      )
      setRows((prev) => prev.filter((row) => row.id !== contractor.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      handleRefresh()
      flash(t('contractors.list.deleteSuccess', 'Contractor deleted successfully'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('contractors.list.deleteError', 'Failed to delete contractor')
      flash(message, 'error')
    }
  }, [handleRefresh, t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleOpenCreateDialog = React.useCallback(() => {
    setCreateForm({ name: '', code: '', taxId: '', legalName: '' })
    setCreateDialogOpen(true)
  }, [])

  const handleCreateContractor = React.useCallback(async () => {
    if (!createForm.name.trim()) {
      flash(t('contractors.create.validation.nameRequired', 'Name is required'), 'error')
      return
    }
    setIsCreating(true)
    try {
      const response = await apiCallOrThrow<{ id?: string }>(
        '/api/contractors/contractors',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: createForm.name.trim(),
            code: createForm.code.trim() || undefined,
            taxId: createForm.taxId.trim() || undefined,
            legalName: createForm.legalName.trim() || undefined,
          }),
        },
        { errorMessage: t('contractors.create.error', 'Failed to create contractor') },
      )
      setCreateDialogOpen(false)
      flash(t('contractors.create.success', 'Contractor created successfully'), 'success')
      handleRefresh()
      if (response?.id) {
        router.push(`/backend/contractors/${response.id}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('contractors.create.error', 'Failed to create contractor')
      flash(message, 'error')
    } finally {
      setIsCreating(false)
    }
  }, [createForm, handleRefresh, router, t])

  const handleCreateKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleCreateContractor()
    }
  }, [handleCreateContractor])

  const columns = React.useMemo<ColumnDef<ContractorRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">—</span>
    return [
      {
        accessorKey: 'name',
        header: t('contractors.list.columns.name', 'Name'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'code',
        header: t('contractors.list.columns.code', 'Code'),
        cell: ({ row }) => row.original.code || noValue,
      },
      {
        accessorKey: 'roles',
        header: t('contractors.list.columns.roles', 'Roles'),
        cell: ({ row }) => {
          const roles = row.original.roles || []
          if (!roles.length) return noValue
          return (
            <div className="flex flex-wrap gap-1">
              {roles.slice(0, 3).map((role) => (
                <Badge
                  key={role.code}
                  variant="secondary"
                  style={role.color ? { backgroundColor: role.color, color: '#fff' } : undefined}
                >
                  {role.name}
                </Badge>
              ))}
              {roles.length > 3 && (
                <Badge variant="outline">+{roles.length - 3}</Badge>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'primaryContactName',
        header: t('contractors.list.columns.contact', 'Primary Contact'),
        cell: ({ row }) => row.original.primaryContactName || noValue,
      },
      {
        accessorKey: 'location',
        header: t('contractors.list.columns.location', 'Location'),
        cell: ({ row }) => {
          const city = row.original.primaryAddressCity
          const country = row.original.primaryAddressCountry
          if (!city && !country) return noValue
          return [city, country].filter(Boolean).join(', ')
        },
      },
      {
        accessorKey: 'isActive',
        header: t('contractors.list.columns.status', 'Status'),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
            {row.original.isActive
              ? t('contractors.list.status.active', 'Active')
              : t('contractors.list.status.inactive', 'Inactive')}
          </Badge>
        ),
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<ContractorRow>
          title={t('contractors.list.title', 'Contractors')}
          refreshButton={{
            label: t('contractors.list.actions.refresh', 'Refresh'),
            onRefresh: () => { setSearch(''); setPage(1); handleRefresh() },
          }}
          actions={(
            <Button onClick={handleOpenCreateDialog}>
              {t('contractors.list.actions.new', 'New Contractor')}
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('contractors.list.searchPlaceholder', 'Search contractors...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          onRowClick={(row) => router.push(`/backend/contractors/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('contractors.list.actions.view', 'View'),
                  onSelect: () => { router.push(`/backend/contractors/${row.id}`) },
                },
                {
                  label: t('contractors.list.actions.edit', 'Edit'),
                  onSelect: () => { router.push(`/backend/contractors/${row.id}/edit`) },
                },
                {
                  label: t('contractors.list.actions.openInNewTab', 'Open in New Tab'),
                  onSelect: () => window.open(`/backend/contractors/${row.id}`, '_blank', 'noopener'),
                },
                {
                  label: t('contractors.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent onKeyDown={handleCreateKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('contractors.create.title', 'New Contractor')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t('contractors.create.fields.name', 'Name')} *</Label>
              <Input
                id="name"
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('contractors.create.placeholders.name', 'Enter contractor name')}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code">{t('contractors.create.fields.code', 'Code')}</Label>
              <Input
                id="code"
                value={createForm.code}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder={t('contractors.create.placeholders.code', 'Optional unique code')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="taxId">{t('contractors.create.fields.taxId', 'Tax ID')}</Label>
              <Input
                id="taxId"
                value={createForm.taxId}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, taxId: e.target.value }))}
                placeholder={t('contractors.create.placeholders.taxId', 'VAT/Tax number')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legalName">{t('contractors.create.fields.legalName', 'Legal Name')}</Label>
              <Input
                id="legalName"
                value={createForm.legalName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, legalName: e.target.value }))}
                placeholder={t('contractors.create.placeholders.legalName', 'Official registered name')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t('contractors.create.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleCreateContractor} disabled={isCreating}>
              {isCreating ? t('contractors.create.creating', 'Creating...') : t('contractors.create.submit', 'Create')}
            </Button>
          </DialogFooter>
          <p className="text-xs text-muted-foreground text-center">
            {t('contractors.create.hint', 'Press ⌘+Enter to create')}
          </p>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
