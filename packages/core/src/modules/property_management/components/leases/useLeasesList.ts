"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { applyLeaseCrmAccess, type LeaseSummary } from './leaseModel'
import { NO_CRM_ACCESS, readCrmAccess, type CrmAccess } from '../crmAccess'

export const LEASES_PAGE_SIZE = 50
export const ALL_BUILDINGS = 'all'
export const UNAVAILABLE_CHIP = 'unavailable'

const STATUS_CHIPS: Record<string, string> = {
  all: '',
  active: 'active',
  proposed: 'proposed',
  activating: 'pending_order',
  ended: 'ended',
  closed: 'withdrawn,expired,declined',
  unavailable: '',
}

type ListPayload = { items?: LeaseSummary[]; total?: number; totalPages?: number; crmAccess?: unknown; error?: string }

export function useLeasesList() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<LeaseSummary[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [chip, setChip] = React.useState('all')
  const [buildingId, setBuildingId] = React.useState(ALL_BUILDINGS)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [crmAccess, setCrmAccess] = React.useState<CrmAccess>(NO_CRM_ACCESS)
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  const [filterScope, setFilterScope] = React.useState(scopeVersion)
  if (filterScope !== scopeVersion) {
    setFilterScope(scopeVersion)
    setBuildingId(ALL_BUILDINGS)
    setPage(1)
  }

  React.useEffect(() => {
    let cancelled = false
    const failed = (message?: string | null) => {
      if (cancelled) return
      setRows([])
      setTotal(0)
      setTotalPages(1)
      setLoadError(message ?? t('property_management.leases.list.loadError', 'Could not load leases.'))
    }
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(LEASES_PAGE_SIZE) })
    if (search.trim()) params.set('search', search.trim())
    if (STATUS_CHIPS[chip]) params.set('status', STATUS_CHIPS[chip])
    if (chip === UNAVAILABLE_CHIP) params.set('unitUnavailable', 'true')
    if (buildingId !== ALL_BUILDINGS) params.set('buildingId', buildingId)
    void apiCall<ListPayload>(`/api/property_management/leases?${params.toString()}`, undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          failed(call.result?.error)
          return
        }
        setLoadError(null)
        const access = readCrmAccess(call.result?.crmAccess)
        const items = (Array.isArray(call.result?.items) ? call.result.items : []).map((item) => applyLeaseCrmAccess(item, access))
        setCrmAccess(access)
        setRows(items)
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.leases_list_load_failed' })
        failed()
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, search, chip, buildingId, reloadToken, scopeVersion, t])

  const changeSearch = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])
  const changeChip = React.useCallback((value: string) => {
    setChip(value)
    setPage(1)
  }, [])
  const changeBuilding = React.useCallback((value: string) => {
    setBuildingId(value)
    setPage(1)
  }, [])

  return {
    rows,
    total,
    totalPages,
    loading,
    loadError,
    crmAccess,
    reload,
    page,
    setPage,
    search,
    setSearch: changeSearch,
    chip,
    setChip: changeChip,
    buildingId,
    setBuildingId: changeBuilding,
  }
}
