"use client"
import * as React from 'react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TenantRecord = {
  id: string
  name: string
  isActive: boolean
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
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; tenants: TenantRecord[] }

async function fetchTenants(status: 'all' | 'active' | 'inactive'): Promise<TenantRecord[]> {
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
  return items
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
    .sort((a, b) => a.name.localeCompare(b.name))
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
  },
  ref,
) {
  const t = useT()
  const [fetchState, setFetchState] = React.useState<FetchState>(() => ({ status: fetchOnMount ? 'loading' : 'idle' }))

  React.useEffect(() => {
    if (!fetchOnMount) {
      setFetchState({ status: 'idle' })
      return
    }
    let cancelled = false
    setFetchState({ status: 'loading' })
    fetchTenants(status)
      .then((tenants) => {
        if (!cancelled) setFetchState({ status: 'success', tenants })
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: 'error' })
      })
    return () => { cancelled = true }
  }, [fetchOnMount, status])

  const tenants = React.useMemo(() => {
    if (fetchState.status === 'success') return fetchState.tenants
    return []
  }, [fetchState])

  const isLoading = fetchState.status === 'loading'
  const isError = fetchState.status === 'error'

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
      disabled={disabled || isError}
      required={required}
      className={className}
    >
      {includeEmptyOption ? (
        <option value="">
          {resolvedEmptyOptionLabel}
        </option>
      ) : null}
      {isLoading ? (
        <option value="" disabled>{loadingLabel}</option>
      ) : null}
      {isError ? (
        <option value="" disabled>{errorLabel}</option>
      ) : null}
      {!isLoading && !isError
        ? tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}{tenant.isActive ? '' : inactiveSuffix}
          </option>
        ))
        : null}
    </select>
  )
})
