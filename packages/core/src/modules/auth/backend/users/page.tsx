"use client"
import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildOrganizationTreeOptions, formatOrganizationTreeLabel, type OrganizationTreeNode } from '@open-mercato/core/modules/directory/lib/tree'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

type Row = {
  id: string
  email: string
  organizationId: string | null
  organizationName?: string | null
  tenantId: string | null
  tenantName?: string | null
  roles: string[]
}

type FilterOption = { value: string; label: string }

async function fetchOrganizationFilterOptions(): Promise<FilterOption[]> {
  const search = new URLSearchParams()
  search.set('view', 'tree')
  search.set('status', 'all')
  try {
    const res = await apiFetch(`/api/directory/organizations?${search.toString()}`)
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    const nodes = Array.isArray(data?.items) ? (data.items as OrganizationTreeNode[]) : []
    const flattened = buildOrganizationTreeOptions(nodes)
    return flattened
      .filter((opt) => typeof opt.value === 'string' && opt.value.length > 0)
      .map((opt) => {
        const baseLabel = opt.name && opt.name.length > 0 ? opt.name : opt.value
        const depth = typeof opt.depth === 'number' ? opt.depth : 0
        const label = `${formatOrganizationTreeLabel(baseLabel, depth)}${opt.isActive === false ? ' (inactive)' : ''}`
        return { value: opt.value, label }
      })
  } catch {
    return []
  }
}

async function fetchRoleFilterOptions(query?: string): Promise<FilterOption[]> {
  const search = new URLSearchParams()
  search.set('page', '1')
  search.set('pageSize', '50')
  if (query && query.trim()) search.set('search', query.trim())
  try {
    const res = await apiFetch(`/api/auth/roles?${search.toString()}`)
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    const items = Array.isArray(data?.items) ? data.items : []
    return items
      .map((item: any): FilterOption | null => {
        const id = typeof item?.id === 'string' ? item.id : null
        const name = typeof item?.name === 'string' ? item.name : null
        if (!id || !name) return null
        return { value: id, label: name }
      })
      .filter((opt: FilterOption | null): opt is FilterOption => opt !== null)
  } catch {
    return []
  }
}

async function fetchRoleOptionsByIds(ids: string[]): Promise<FilterOption[]> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim() !== '')))
  if (unique.length === 0) return []
  const results = await Promise.all(unique.map(async (id) => {
    try {
      const search = new URLSearchParams()
      search.set('id', id)
      search.set('page', '1')
      search.set('pageSize', '1')
      const res = await apiFetch(`/api/auth/roles?${search.toString()}`)
      if (!res.ok) return null
      const data = await res.json().catch(() => ({}))
      const match = Array.isArray(data?.items) ? data.items.find((item: any) => item?.id === id) : null
      const name = typeof match?.name === 'string' ? match.name : null
      if (!name) return null
      return { value: id, label: name }
    } catch {
      return null
    }
  }))
  return results.filter((opt: FilterOption | null): opt is FilterOption => opt !== null)
}

function mergeOptions(existing: FilterOption[], next: FilterOption[]): FilterOption[] {
  if (!next.length) return existing
  const map = new Map<string, FilterOption>()
  for (const opt of existing) map.set(opt.value, opt)
  for (const opt of next) map.set(opt.value, opt)
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export default function UsersListPage() {
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'email', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [organizationOptions, setOrganizationOptions] = React.useState<FilterOption[]>([])
  const [roleOptions, setRoleOptions] = React.useState<FilterOption[]>([])
  const [roleLabelToId, setRoleLabelToId] = React.useState<Record<string, string>>({})
  const [roleIdToLabel, setRoleIdToLabel] = React.useState<Record<string, string>>({})
  const [roleFilterDirty, setRoleFilterDirty] = React.useState(false)

  const roleIdsFromUrl = React.useMemo(() => {
    if (!searchParams) return [] as string[]
    const raw = searchParams.getAll('roleId')
    return raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  }, [searchParams])

  const roleIdsFromUrlKey = React.useMemo(() => roleIdsFromUrl.join('|'), [roleIdsFromUrl])
  const organizationId = typeof filterValues.organizationId === 'string' && filterValues.organizationId ? filterValues.organizationId : undefined

  const applyRoleOptions = React.useCallback((opts: FilterOption[]) => {
    if (!opts.length) return
    setRoleOptions((prev) => mergeOptions(prev, opts))
    setRoleLabelToId((prev) => {
      if (!opts.length) return prev
      const next = { ...prev }
      for (const opt of opts) next[opt.label] = opt.value
      return next
    })
    setRoleIdToLabel((prev) => {
      if (!opts.length) return prev
      const next = { ...prev }
      for (const opt of opts) next[opt.value] = opt.label
      return next
    })
  }, [])

  React.useEffect(() => {
    let cancelled = false
    fetchOrganizationFilterOptions().then((opts) => {
      if (!cancelled) setOrganizationOptions(opts)
    })
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    fetchRoleFilterOptions().then((opts) => {
      if (!cancelled) applyRoleOptions(opts)
    })
    return () => { cancelled = true }
  }, [applyRoleOptions])

  React.useEffect(() => {
    if (roleFilterDirty) return
    if (roleIdsFromUrl.length === 0) {
      setFilterValues((prev) => {
        if (!Array.isArray(prev.roles) || prev.roles.length === 0) return prev
        const next = { ...prev }
        delete (next as any).roles
        return next
      })
      return
    }
    const missing = roleIdsFromUrl.filter((id) => !roleIdToLabel[id])
    if (missing.length === 0) {
      const labels = roleIdsFromUrl
        .map((id) => roleIdToLabel[id])
        .filter((label): label is string => typeof label === 'string' && label.length > 0)
      setFilterValues((prev) => {
        const current = Array.isArray(prev.roles) ? prev.roles as string[] : []
        if (arraysEqual(current, labels)) return prev
        return { ...prev, roles: labels }
      })
      return
    }
    let cancelled = false
    ;(async () => {
      const fetched = await fetchRoleOptionsByIds(missing)
      if (cancelled) return
      if (fetched.length) applyRoleOptions(fetched)
      const labelMap = new Map<string, string>()
      for (const opt of fetched) labelMap.set(opt.value, opt.label)
      for (const id of roleIdsFromUrl) {
        if (roleIdToLabel[id]) labelMap.set(id, roleIdToLabel[id])
      }
      const labels = roleIdsFromUrl
        .map((id) => labelMap.get(id))
        .filter((label): label is string => typeof label === 'string' && label.length > 0)
      if (labels.length) {
        setFilterValues((prev) => {
          const current = Array.isArray(prev.roles) ? prev.roles as string[] : []
          if (arraysEqual(current, labels)) return prev
          return { ...prev, roles: labels }
        })
      }
    })()
    return () => { cancelled = true }
  }, [roleFilterDirty, roleIdsFromUrlKey, roleIdsFromUrl, roleIdToLabel, applyRoleOptions])

  React.useEffect(() => {
    setRoleFilterDirty(false)
  }, [roleIdsFromUrlKey])

  const loadRoleOptions = React.useCallback(async (query?: string) => {
    const opts = await fetchRoleFilterOptions(query)
    if (opts.length) applyRoleOptions(opts)
    return opts
  }, [applyRoleOptions])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'organizationId',
      label: 'Organization',
      type: 'select',
      options: organizationOptions,
    },
    {
      id: 'roles',
      label: 'Roles',
      type: 'tags',
      placeholder: 'Filter by roles',
      options: roleOptions,
      loadOptions: loadRoleOptions,
    },
  ], [organizationOptions, roleOptions, loadRoleOptions])

  const roleIdsFromFilter = React.useMemo(() => {
    const raw = Array.isArray(filterValues.roles) ? filterValues.roles as string[] : []
    return raw
      .map((label) => roleLabelToId[label])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }, [filterValues.roles, roleLabelToId])

  const effectiveRoleIds = React.useMemo(() => {
    if (roleFilterDirty) return roleIdsFromFilter
    if (roleIdsFromFilter.length > 0) return roleIdsFromFilter
    return roleIdsFromUrl
  }, [roleFilterDirty, roleIdsFromFilter, roleIdsFromUrl])

  const normalizedRoleIds = React.useMemo(() => {
    if (!effectiveRoleIds.length) return [] as string[]
    const unique = Array.from(new Set(effectiveRoleIds))
    unique.sort()
    return unique
  }, [effectiveRoleIds])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    const org = typeof values.organizationId === 'string' ? values.organizationId.trim() : ''
    if (org) next.organizationId = org
    const rawRoles = Array.isArray(values.roles) ? (values.roles as string[]) : []
    const sanitizedRoles = rawRoles.map((role) => role.trim()).filter((role) => role.length > 0)
    if (sanitizedRoles.length) next.roles = sanitizedRoles
    setFilterValues(next)
    setRoleFilterDirty(true)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setRoleFilterDirty(true)
    setPage(1)
  }, [])

  const params = React.useMemo(() => {
    const p = new URLSearchParams()
    p.set('page', String(page))
    p.set('pageSize', '50')
    if (search) p.set('search', search)
    if (organizationId) p.set('organizationId', organizationId)
    if (normalizedRoleIds.length) {
      for (const id of normalizedRoleIds) p.append('roleId', id)
    }
    return p.toString()
  }, [page, search, organizationId, normalizedRoleIds])

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', params, scopeVersion],
    queryFn: async () => {
      const res = await apiFetch(`/api/auth/users?${params}`)
      return res.json() as Promise<{ items: Row[]; total: number; totalPages: number; isSuperAdmin?: boolean }>
    },
  })

  const rows = usersData?.items || []
  const total = usersData?.total || 0
  const totalPages = usersData?.totalPages || 1
  const isSuperAdmin = !!usersData?.isSuperAdmin
  const rowsWithOrgNames: Row[] = React.useMemo(() => rows.map(row => ({
    ...row,
    organizationName: row.organizationName ?? (row.organizationId ?? undefined),
    tenantName: row.tenantName ?? (row.tenantId ?? undefined),
  })), [rows])
  const showTenantColumn = React.useMemo(
    () => isSuperAdmin && rowsWithOrgNames.some((row) => row.tenantName),
    [isSuperAdmin, rowsWithOrgNames],
  )
  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    const base: ColumnDef<Row>[] = [
      { accessorKey: 'email', header: 'Email' },
      { accessorKey: 'organizationName', header: 'Organization' },
      { accessorKey: 'roles', header: 'Roles', cell: ({ row }) => (row.original.roles || []).join(', ') },
    ]
    if (showTenantColumn) {
      base.splice(1, 0, { accessorKey: 'tenantName', header: 'Tenant' })
    }
    return base
  }, [showTenantColumn])

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(`Delete user "${row.email}"?`)) return
    try {
      const res = await apiFetch(`/api/auth/users?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        let message = 'Failed to delete user'
        try {
          const data = await res.json()
          if (data?.error && typeof data.error === 'string') message = data.error
        } catch {}
        throw new Error(message)
      }
      flash('User deleted', 'success')
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete user'
      flash(message, 'error')
    }
  }, [queryClient])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="Users"
          actions={(
            <Button asChild>
              <Link href="/backend/users/create">Create</Link>
            </Button>
          )}
          columns={columns}
          data={rowsWithOrgNames}
          searchValue={search}
          onSearchChange={handleSearchChange}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          perspective={{ tableId: 'auth.users.list' }}
          rowActions={(row) => (
            <RowActions items={[
              { label: 'Edit', href: `/backend/users/${row.id}/edit` },
              { label: 'Show roles', href: `/backend/roles?userId=${encodeURIComponent(row.id)}` },
              { label: 'Delete', destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
