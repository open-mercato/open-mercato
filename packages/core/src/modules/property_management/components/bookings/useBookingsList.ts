"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { applyBookingsCrmAccess, type BookingSummary } from './bookingModel'
import { NO_CRM_ACCESS, readCrmAccess, type CrmAccess } from '../crmAccess'

type ListPayload = { items?: BookingSummary[]; total?: number; totalPages?: number; crmAccess?: unknown; error?: string }

export type BookingsListState = {
  rows: BookingSummary[]
  total: number
  totalPages: number
  loading: boolean
  loadError: string | null
  crmAccess: CrmAccess
}

export function useBookingsList(params: URLSearchParams, reloadKey: string): BookingsListState {
  const t = useT()
  const query = params.toString()
  const [rows, setRows] = React.useState<BookingSummary[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [crmAccess, setCrmAccess] = React.useState<CrmAccess>(NO_CRM_ACCESS)

  React.useEffect(() => {
    let cancelled = false
    const failed = t('property_management.bookings.list.loadError', 'Could not load bookings.')
    setLoading(true)
    void apiCall<ListPayload>(`/api/property_management/bookings?${query}`, undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setRows([])
          setTotal(0)
          setTotalPages(1)
          setLoadError(call.result?.error ?? failed)
          return
        }
        setLoadError(null)
        const access = readCrmAccess(call.result?.crmAccess)
        const items = applyBookingsCrmAccess(Array.isArray(call.result?.items) ? call.result.items : [], access)
        setCrmAccess(access)
        setRows(items)
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      })
      .catch(() => {
        if (cancelled) return
        setRows([])
        setTotal(0)
        setTotalPages(1)
        setLoadError(failed)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, reloadKey, t])

  return { rows, total, totalPages, loading, loadError, crmAccess }
}
