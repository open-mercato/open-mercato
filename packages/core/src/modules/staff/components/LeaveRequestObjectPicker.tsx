"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ObjectPickerComponentProps, ObjectPickerRecord } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

type LeaveRequestListItem = {
  id?: string | null
  status?: string | null
  start_date?: string | null
  end_date?: string | null
  member?: {
    displayName?: string | null
  } | null
}

type LeaveRequestListResponse = {
  items?: LeaveRequestListItem[]
}

function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? null
    )
  }
  return null
}

function formatDate(value?: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString()
}

function toRecord(item: LeaveRequestListItem): ObjectPickerRecord | null {
  const id = typeof item.id === 'string' ? item.id : ''
  if (!id) return null
  const status = typeof item.status === 'string' ? item.status : null
  const memberName = typeof item.member?.displayName === 'string' ? item.member.displayName : null
  const startDate = formatDate(item.start_date)
  const endDate = formatDate(item.end_date)
  const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : (startDate ?? endDate)
  return {
    id,
    label: memberName ?? id,
    subtitle: [status, dateRange].filter(Boolean).join(' • ') || undefined,
    snapshot: {
      status: status ?? undefined,
      memberName: memberName ?? undefined,
      startDate: item.start_date ?? undefined,
      endDate: item.end_date ?? undefined,
    },
  }
}

export function LeaveRequestObjectPicker({
  selectedRecord,
  onSelectRecord,
  queryState,
  onQueryStateChange,
}: ObjectPickerComponentProps) {
  const t = useT()
  const search = typeof queryState.search === 'string' ? queryState.search : ''
  const page = typeof queryState.page === 'number' && queryState.page > 0 ? queryState.page : 1
  const pageSize = Math.min(
    50,
    typeof queryState.pageSize === 'number' && queryState.pageSize > 0 ? queryState.pageSize : 20,
  )
  const status = typeof queryState.filters?.status === 'string' ? queryState.filters.status : ''

  const recordsQuery = useQuery({
    queryKey: ['staff', 'leave-requests', 'object-picker', search, status, page, pageSize],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (search.trim()) {
        params.set('search', search.trim())
      }
      if (status.trim()) {
        params.set('status', status.trim())
      }
      const call = await apiCall<LeaveRequestListResponse>(`/api/staff/leave-requests?${params.toString()}`)
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('staff.leaveRequests.errors.loadFailed', 'Failed to load leave requests.'),
        )
      }
      const rawItems = Array.isArray(call.result?.items) ? call.result.items : []
      const items: ObjectPickerRecord[] = []
      for (const item of rawItems) {
        const mapped = toRecord(item)
        if (mapped) items.push(mapped)
      }
      return items
    },
  })

  const records = recordsQuery.data ?? []

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="messages-object-leave-request-search">
            {t('messages.composer.objectPicker.recordSearchLabel', 'Search records')}
          </Label>
          <Input
            id="messages-object-leave-request-search"
            value={search}
            onChange={(event) => onQueryStateChange({
              ...queryState,
              search: event.target.value,
              page: 1,
              pageSize,
            })}
            placeholder={t('messages.composer.objectPicker.recordSearchPlaceholder', 'Type to find a record')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="messages-object-leave-request-status">
            {t('staff.leaveRequests.fields.status', 'Status')}
          </Label>
          <select
            id="messages-object-leave-request-status"
            value={status}
            onChange={(event) => onQueryStateChange({
              ...queryState,
              page: 1,
              pageSize,
              filters: {
                ...(queryState.filters ?? {}),
                status: event.target.value || undefined,
              },
            })}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">
              {t('common.all', 'All')}
            </option>
            <option value="pending">{t('staff.leaveRequests.status.pending', 'Pending')}</option>
            <option value="approved">{t('staff.leaveRequests.status.approved', 'Approved')}</option>
            <option value="rejected">{t('staff.leaveRequests.status.rejected', 'Rejected')}</option>
          </select>
        </div>
      </div>

      {recordsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.composer.objectPicker.loadingRecords', 'Loading records...')}
        </p>
      ) : null}

      {recordsQuery.error instanceof Error ? (
        <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <p>{recordsQuery.error.message}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void recordsQuery.refetch()}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {records.map((record) => (
          <button
            key={record.id}
            type="button"
            className={`w-full rounded-md border p-3 text-left transition-colors ${
              selectedRecord?.id === record.id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted/50'
            }`}
            onClick={() => onSelectRecord(record)}
          >
            <p className="text-sm font-medium">{record.label}</p>
            {record.subtitle ? (
              <p className="text-xs text-muted-foreground">{record.subtitle}</p>
            ) : null}
          </button>
        ))}
      </div>

      {!recordsQuery.isLoading && !(recordsQuery.error instanceof Error) && records.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.composer.objectPicker.noRecords', 'No records found for this object type.')}
        </p>
      ) : null}
    </div>
  )
}

export default LeaveRequestObjectPicker
