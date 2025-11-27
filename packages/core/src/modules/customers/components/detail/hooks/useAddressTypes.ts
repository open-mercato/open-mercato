import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  customerDictionaryQueryOptions,
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
} from './useCustomerDictionary'

export type AddressTypeOption = { value: string; label: string }

export type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

type UseAddressTypesResult = {
  options: AddressTypeOption[]
  map: Map<string, string>
  loading: boolean
  error: string | null
  createType: (value: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useAddressTypes(t: Translator): UseAddressTypesResult {
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data, isLoading, isFetching, refetch } = useQuery(
    customerDictionaryQueryOptions('address-types', scopeVersion),
  )

  const options = React.useMemo<AddressTypeOption[]>(() => {
    if (!data?.entries) return []
    return data.entries
      .map((entry) => ({ value: entry.value, label: entry.label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [data])

  const map = React.useMemo(() => {
    return options.reduce((acc, entry) => {
      acc.set(entry.value, entry.label)
      return acc
    }, new Map<string, string>())
  }, [options])

  const createType = React.useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed.length || creating) return
      setCreating(true)
      setError(null)
      try {
        const call = await apiCall<Record<string, unknown>>('/api/customers/dictionaries/address-types', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: trimmed }),
        })
        const payload = call.result ?? null
        if (!call.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.people.detail.addresses.types.errorSave', 'Failed to save address type')
          setError(message)
          flash(message, 'error')
          return
        }
        await invalidateCustomerDictionary(queryClient, 'address-types')
        await ensureCustomerDictionary(queryClient, 'address-types', scopeVersion)
        await refetch()
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.people.detail.addresses.types.errorSave', 'Failed to save address type')
        setError(message)
        flash(message, 'error')
      } finally {
        setCreating(false)
      }
    },
    [creating, queryClient, refetch, scopeVersion, t],
  )

  const refresh = React.useCallback(async () => {
    setError(null)
    await invalidateCustomerDictionary(queryClient, 'address-types')
    await ensureCustomerDictionary(queryClient, 'address-types', scopeVersion)
    await refetch()
  }, [queryClient, refetch, scopeVersion])

  React.useEffect(() => {
    if (!data?.entries || data.entries.length) return
    setError(null)
  }, [data])

  return {
    options,
    map,
    loading: isLoading || isFetching || creating,
    error,
    createType,
    refresh,
  }
}
