"use client"
import * as React from 'react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type TenantRecord = {
  id: string
  name: string
  isActive: boolean
}

function normalizeTenant(tenant: TenantRecord | null | undefined): TenantRecord | null {
  if (!tenant || typeof tenant.id !== 'string' || tenant.id.trim().length === 0) return null
  const id = tenant.id.trim()
  const name = typeof tenant.name === 'string' && tenant.name.trim().length > 0 ? tenant.name.trim() : id
  const isActive = tenant.isActive !== false
  return { id, name, isActive }
}

function sanitizeTenantList(list?: TenantRecord[] | null): TenantRecord[] {
  if (!Array.isArray(list)) return []
  const seen = new Map<string, TenantRecord>()
  for (const tenant of list) {
    const normalized = normalizeTenant(tenant)
    if (!normalized) continue
    seen.set(normalized.id, normalized)
  }
  return Array.from(seen.values())
}

function mergeTenantLists(...lists: TenantRecord[][]): TenantRecord[] {
  const map = new Map<string, TenantRecord>()
  for (const list of lists) {
    for (const tenant of list) {
      if (!tenant || typeof tenant.id !== 'string' || tenant.id.trim().length === 0) continue
      const id = tenant.id.trim()
      const existing = map.get(id)
      if (!existing) {
        map.set(id, {
          id,
          name: typeof tenant.name === 'string' && tenant.name.length > 0 ? tenant.name : id,
          isActive: tenant.isActive !== false,
        })
      } else {
        const name = typeof tenant.name === 'string' && tenant.name.length > 0 ? tenant.name : existing.name
        const isActive = tenant.isActive !== undefined ? tenant.isActive !== false : existing.isActive
        map.set(id, { id, name, isActive })
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function filterTenantsByStatus(list: TenantRecord[], status: 'all' | 'active' | 'inactive'): TenantRecord[] {
  if (status === 'active') return list.filter((tenant) => tenant.isActive)
  if (status === 'inactive') return list.filter((tenant) => !tenant.isActive)
  return list
}

async function fetchDirectoryTenants(status: 'all' | 'active' | 'inactive'): Promise<TenantRecord[]> {
  const search = new URLSearchParams()
  search.set('page', '1')
  search.set('pageSize', '200')
  search.set('sortField', 'name')
  search.set('sortDir', 'asc')
  if (status === 'active') search.set('isActive', 'true')
  if (status === 'inactive') search.set('isActive', 'false')
  const res = await apiFetch(`/api/directory/tenants?${search.toString()}`)
  if (!res.ok) throw new Error('Failed to load tenants')
  const json = await res.json().catch(() => ({}))
  const items = Array.isArray(json.items) ? json.items : []
  const normalized = items
    .map((item: unknown): TenantRecord | null => {
      if (!item || typeof item !== 'object') return null
      const entry = item as Record<string, unknown>
      const rawId = entry.id
      const id = typeof rawId === 'string' ? rawId : null
      if (!id || !id.length) return null
      const rawName = entry.name
      const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : id
      const isActive = entry.isActive !== false
      return { id, name, isActive }
    })
    .filter((tenant): tenant is TenantRecord => tenant !== null)
  return mergeTenantLists(filterTenantsByStatus(normalized, status))
}

async function fetchTenantsFromOrganizationSwitcher(status: 'all' | 'active' | 'inactive'): Promise<TenantRecord[]> {
  const res = await apiFetch('/api/directory/organization-switcher')
  if (!res.ok) throw new Error('Failed to load tenants from organization switcher')
  const json = await res.json().catch(() => ({}))
  const payload = (json && typeof json === 'object') ? (json as Record<string, unknown>) : {}
  const rawTenants = Array.isArray(payload.tenants) ? payload.tenants : []
  const sanitized = sanitizeTenantList(rawTenants as TenantRecord[] | null)
  return mergeTenantLists(filterTenantsByStatus(sanitized, status))
}

export type TenantSelectProps = {
  value?: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
  required?: boolean
  className?: string
  id?: string
  name?: string
  includeEmptyOption?: boolean
  emptyOptionLabel?: string
  fetchOnMount?: boolean
  status?: 'all' | 'active' | 'inactive'
  tenants?: TenantRecord[] | null
}

export const TenantSelect = React.forwardRef<HTMLSelectElement, TenantSelectProps>(function TenantSelect(
  {
    value,
    onChange,
    disabled = false,
    required = false,
    className,
    id,
    name,
    includeEmptyOption = false,
    emptyOptionLabel,
    fetchOnMount = true,
    status = 'all',
    tenants: providedTenantsInput = null,
  },
  ref,
) {
  const t = useT()
  const providedTenants = React.useMemo(() => sanitizeTenantList(providedTenantsInput), [providedTenantsInput])
  const [remoteTenants, setRemoteTenants] = React.useState<TenantRecord[]>([])
  const [fetchStatus, setFetchStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>(fetchOnMount ? 'loading' : 'idle')

  React.useEffect(() => {
    if (!fetchOnMount) {
      setFetchStatus((prev) => (prev === 'loading' ? 'idle' : prev))
      return
    }
    let cancelled = false
    const loadTenants = async () => {
      setFetchStatus('loading')
      try {
        const tenants = await fetchDirectoryTenants(status)
        if (cancelled) return
        setRemoteTenants(tenants)
        setFetchStatus('success')
        return
      } catch {
        try {
          const fallbackTenants = await fetchTenantsFromOrganizationSwitcher(status)
          if (cancelled) return
          setRemoteTenants(fallbackTenants)
          setFetchStatus('success')
          return
        } catch {
          if (cancelled) return
          setFetchStatus('error')
        }
      }
    }
    void loadTenants()
    return () => { cancelled = true }
  }, [fetchOnMount, status])

  const mergedTenants = React.useMemo(
    () => mergeTenantLists(providedTenants, remoteTenants),
    [providedTenants, remoteTenants],
  )

  const fallbackTenant = React.useMemo(() => {
    const tenantId = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
    if (!tenantId) return null
    if (mergedTenants.some((tenant) => tenant.id === tenantId)) return null
    return { id: tenantId, name: tenantId, isActive: true }
  }, [mergedTenants, value])

  const tenantsForRender = React.useMemo(
    () => (fallbackTenant ? mergeTenantLists(mergedTenants, [fallbackTenant]) : mergedTenants),
    [mergedTenants, fallbackTenant],
  )

  const showLoading = fetchStatus === 'loading' && tenantsForRender.length === 0
  const showError = fetchStatus === 'error' && tenantsForRender.length === 0

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!onChange) return
    const next = event.target.value
    onChange(next ? next : null)
  }, [onChange])

  const selectValue = value ?? ''
  const resolvedEmptyOptionLabel = emptyOptionLabel ?? t('tenantSelect.empty')
  const loadingLabel = t('tenantSelect.loading')
  const errorLabel = t('tenantSelect.error')
  const inactiveSuffix = ` (${t('tenantSelect.inactive')})`

  return (
    <select
      ref={ref}
      id={id}
      name={name}
      value={selectValue}
      onChange={handleChange}
      disabled={disabled || (showError && tenantsForRender.length === 0)}
      required={required}
      className={className}
    >
      {includeEmptyOption ? (
        <option value="">
          {resolvedEmptyOptionLabel}
        </option>
      ) : null}
      {showLoading ? (
        <option value="" disabled>{loadingLabel}</option>
      ) : null}
      {showError ? (
        <option value="" disabled>{errorLabel}</option>
      ) : null}
      {!showLoading && tenantsForRender.length > 0
        ? tenantsForRender.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}{tenant.isActive ? '' : inactiveSuffix}
          </option>
        ))
        : null}
    </select>
  )
})
