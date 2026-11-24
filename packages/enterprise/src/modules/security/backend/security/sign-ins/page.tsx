'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation.js'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { extensionPoints } from '../../../extension-points'
import { SignInDevice, SignInMfa, SignInNewDeviceBadge, SignInReason, SignInResultBadge, SignInTime, type AdminSignIn } from '../../../components/SignInDisplay'
import { SignInDetail } from './SignInDetail'

const pageSize = 25
const periodHours = { '24h': 24, '7d': 168, '30d': 720 } as const
const allowedListParams = ['userId', 'result', 'ip', 'from', 'to', 'page', 'sort']

type SignInList = { items: AdminSignIn[]; total: number; totalPages: number; page: number }
type UserOptions = { items: Array<{ id: string; email: string; name?: string | null }> }

function filterDate(value: unknown, endOfDay = false): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setHours(23, 59, 59, 999)
  return date.toISOString()
}

function buildFilterParams(values: FilterValues) {
  const params = new URLSearchParams()
  for (const key of ['userId', 'result', 'ip']) {
    const value: unknown = values[key]
    if (typeof value === 'string' && value.trim() && (key !== 'result' || value !== 'all')) {
      params.set(key, value.trim())
    }
  }

  const period: unknown = values.period
  if (typeof period === 'string' && Object.hasOwn(periodHours, period)) {
    const from = new Date(Date.now() - periodHours[period as keyof typeof periodHours] * 3_600_000)
    params.set('from', from.toISOString())
    params.set('period', period)
  } else {
    const from = filterDate(values.range?.from)
    const to = filterDate(values.range?.to, true)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
  }
  return params
}

export default function SignInActivityPage() {
  const t = useT()
  const router = useRouter()
  const search = useSearchParams().toString()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const [detailId, setDetailId] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [list, setList] = useState<{ requestKey: string; data: SignInList | null; error: boolean } | null>(null)
  const [refresh, setRefresh] = useState(0)

  const apiQuery = useMemo(() => {
    const query = new URLSearchParams({ pageSize: String(pageSize) })
    for (const key of allowedListParams) {
      const value = params.get(key)
      if (value) query.set(key, value)
    }
    return query.toString()
  }, [params])
  const requestKey = `${apiQuery}:${refresh}`

  useEffect(() => {
    const controller = new AbortController()
    void apiCall<SignInList>(`/api/security/sign-ins?${apiQuery}`, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setList({ requestKey, data: response.ok ? response.result : null, error: !response.ok || !response.result })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setList({ requestKey, data: null, error: true })
      })
    return () => controller.abort()
  }, [apiQuery, requestKey])

  const openDetail = (id: string, trigger: HTMLElement | null) => {
    returnFocusRef.current = trigger
    setDetailId(id)
  }
  const closeDetail = () => {
    setDetailId(null)
    requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  const columns: ColumnDef<AdminSignIn>[] = [
    {
      id: 'occurredAt',
      accessorKey: 'occurredAt',
      header: t('security.signIns.column.time'),
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-1"
          aria-label={t('security.signIns.detail.open')}
          onClick={(event) => {
            event.stopPropagation()
            openDetail(row.original.id, event.currentTarget)
          }}
        >
          <SignInTime value={row.original.occurredAt} />
        </Button>
      ),
    },
    {
      id: 'user',
      header: t('security.signIns.column.user'),
      enableSorting: false,
      cell: ({ row }) => {
        const { userName, email } = row.original
        return userName && email
          ? <div><div>{userName}</div><div className="text-xs text-muted-foreground">{email}</div></div>
          : userName || email || t('security.signIns.unknownAccount')
      },
    },
    { id: 'result', header: t('security.signIns.column.result'), enableSorting: false, cell: ({ row }) => <SignInResultBadge result={row.original.result} /> },
    { id: 'reason', header: t('security.signIns.column.reason'), enableSorting: false, cell: ({ row }) => <SignInReason reason={row.original.reason} /> },
    { id: 'mfa', header: t('security.signIns.column.mfa'), enableSorting: false, cell: ({ row }) => <SignInMfa status={row.original.mfaStatus} /> },
    { id: 'ip', header: t('security.signIns.column.ip'), enableSorting: false, cell: ({ row }) => row.original.ipAddress ?? '—' },
    { id: 'device', header: t('security.signIns.column.device'), enableSorting: false, cell: ({ row }) => <SignInDevice item={row.original} /> },
    { id: 'newDevice', header: t('security.signIns.column.newDevice'), enableSorting: false, cell: ({ row }) => row.original.isNewDevice ? <SignInNewDeviceBadge /> : null },
  ]

  const filters = useMemo<FilterDef[]>(() => [
    {
      id: 'userId',
      label: t('security.signIns.column.user'),
      type: 'combobox',
      loadOptions: async (searchValue) => {
        const query = new URLSearchParams({ pageSize: '25' })
        if (searchValue?.trim()) query.set('search', searchValue.trim())
        const response = await apiCall<UserOptions>(`/api/auth/users?${query}`)
        return response.result?.items?.map((user) => ({ value: user.id, label: user.name || user.email, description: user.name ? user.email : null })) ?? []
      },
    },
    {
      id: 'result',
      label: t('security.signIns.column.result'),
      type: 'select',
      options: [
        { value: 'all', label: t('ui.filters.all') },
        { value: 'success', label: t('security.signIns.result.success') },
        { value: 'failure', label: t('security.signIns.result.failure') },
      ],
    },
    {
      id: 'period',
      label: t('security.signIns.filters.period'),
      type: 'select',
      options: [
        { value: 'custom', label: t('security.signIns.filters.custom') },
        { value: '24h', label: t('security.signIns.filters.day') },
        { value: '7d', label: t('security.signIns.filters.week') },
        { value: '30d', label: t('security.signIns.filters.month') },
      ],
    },
    { id: 'range', label: t('security.signIns.filters.range'), type: 'dateRange' },
    { id: 'ip', label: t('security.signIns.column.ip'), type: 'text' },
  ], [t])

  const filterValues = useMemo<FilterValues>(() => {
    const values: FilterValues = {}
    for (const key of ['userId', 'result', 'period', 'ip']) {
      const value = params.get(key)
      if (value) values[key] = value
    }
    const from = params.get('from') ?? undefined
    const to = params.get('to') ?? undefined
    if (!values.period && (from || to)) values.range = { from, to }
    return values
  }, [params])

  function navigate(next: URLSearchParams) {
    closeDetail()
    const query = next.toString()
    router.push(query ? `/backend/security/sign-ins?${query}` : '/backend/security/sign-ins', { scroll: false })
  }

  useEffect(() => {
    setDetailId(null)
  }, [search])

  const isLoading = list?.requestKey !== requestKey
  const data = isLoading ? null : list?.data
  return (
    <Page>
      <PageBody>
        <DataTable<AdminSignIn>
          title={t('security.signIns.title')}
          titleHeadingLevel={1}
          extensionTableId={extensionPoints.hosts.signInsTable.tableId}
          columns={columns}
          data={data?.items ?? []}
          exporter={false}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            const next = buildFilterParams(values)
            const sort = params.get('sort')
            if (sort) next.set('sort', sort)
            navigate(next)
          }}
          onFiltersClear={() => navigate(new URLSearchParams())}
          onRowClick={(item, event) => openDetail(item.id, event.currentTarget.querySelector('button'))}
          isLoading={isLoading}
          error={!isLoading && list?.error ? <ErrorMessage label={t('security.signIns.errors.list')} /> : null}
          emptyState={<EmptyState title={t('security.signIns.empty')} />}
          sortable
          manualSorting
          sorting={[{ id: 'occurredAt', desc: params.get('sort') !== 'occurredAt:asc' }]}
          onSortingChange={(sorting) => {
            const next = new URLSearchParams(params)
            next.set('sort', sorting[0]?.desc === false ? 'occurredAt:asc' : 'occurredAt:desc')
            next.delete('page')
            navigate(next)
          }}
          pagination={{
            page: data?.page ?? (Number(params.get('page')) || 1),
            pageSize,
            total: data?.total ?? 0,
            totalIsCapped: false,
            totalPages: data?.totalPages ?? 1,
            onPageChange: (page) => {
              const next = new URLSearchParams(params)
              if (page === 1) next.delete('page')
              else next.set('page', String(page))
              navigate(next)
            },
          }}
          refreshButton={{ label: t('ui.actions.refresh'), onRefresh: () => setRefresh((value) => value + 1) }}
        />
        <SignInDetail id={detailId} onClose={closeDetail} />
      </PageBody>
    </Page>
  )
}
