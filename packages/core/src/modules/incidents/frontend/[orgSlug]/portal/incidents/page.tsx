"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { DataTable, type DataTableProps } from '@open-mercato/ui'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveCatalogLabel } from '../../../../lib/catalogLabels'

type Props = { params: { orgSlug: string } }

type PortalSeverity = {
  key: string
  label: string
  colorToken: string
}

type PortalIncidentUpdate = {
  id: string
  body: string | null
  createdAt: string
}

type PortalIncident = {
  id: string
  number: string
  title: string
  status: string
  severity: PortalSeverity | null
  createdAt: string
  resolvedAt: string | null
  updates: PortalIncidentUpdate[]
}

type PortalIncidentsResponse = {
  items: PortalIncident[]
  total: number
}

function isPortalIncident(value: unknown): value is PortalIncident {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.number === 'string' &&
    typeof record.title === 'string' &&
    typeof record.status === 'string' &&
    typeof record.createdAt === 'string' &&
    Array.isArray(record.updates)
  )
}

function isPortalIncidentsResponse(value: unknown): value is PortalIncidentsResponse {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.items) &&
    record.items.every(isPortalIncident) &&
    typeof record.total === 'number'
  )
}

function severityVariant(colorToken: string | null | undefined): StatusBadgeVariant {
  if (colorToken === 'success') return 'success'
  if (colorToken === 'warning') return 'warning'
  if (colorToken === 'error') return 'error'
  if (colorToken === 'info') return 'info'
  return 'neutral'
}

function statusVariant(status: string): StatusBadgeVariant {
  if (status === 'open') return 'error'
  if (status === 'investigating' || status === 'identified') return 'warning'
  if (status === 'mitigated') return 'info'
  if (status === 'resolved') return 'success'
  return 'neutral'
}

function statusLabel(t: ReturnType<typeof useT>, status: string): string {
  if (status === 'open') return t('incidents.portal.status.open', 'Open')
  if (status === 'investigating') return t('incidents.portal.status.investigating', 'Investigating')
  if (status === 'identified') return t('incidents.portal.status.identified', 'Identified')
  if (status === 'mitigated') return t('incidents.portal.status.mitigated', 'Mitigated')
  if (status === 'resolved') return t('incidents.portal.status.resolved', 'Resolved')
  if (status === 'closed') return t('incidents.portal.status.closed', 'Closed')
  return status || t('incidents.portal.status.unknown', 'Unknown')
}

function severityLabel(t: ReturnType<typeof useT>, severity: PortalSeverity | null): string {
  if (!severity) return t('incidents.portal.severity.none', 'Unspecified')
  return resolveCatalogLabel(t, 'severity', severity.key, severity.label)
}

function formatPortalDate(t: ReturnType<typeof useT>, value: string | null): string {
  if (!value) return t('incidents.portal.date.none', 'Not set')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.portal.date.invalid', 'Invalid date')
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function updateCountLabel(t: ReturnType<typeof useT>, count: number): string {
  if (count === 1) return t('incidents.portal.updates.one', '1 update')
  return t('incidents.portal.updates.many', '{count} updates', { count })
}

function UpdatesFeed({
  incident,
  expanded,
  onToggle,
}: {
  incident: PortalIncident
  expanded: boolean
  onToggle: (id: string) => void
}) {
  const t = useT()
  const hasUpdates = incident.updates.length > 0

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit whitespace-nowrap rounded-lg text-sm"
        onClick={(event) => {
          event.stopPropagation()
          onToggle(incident.id)
        }}
        disabled={!hasUpdates}
      >
        {expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        {hasUpdates
          ? updateCountLabel(t, incident.updates.length)
          : t('incidents.portal.updates.none', 'No customer updates')}
      </Button>

      {expanded && hasUpdates ? (
        <ul className="flex flex-col gap-3">
          {incident.updates.map((update) => (
            <li key={update.id} className="rounded-lg border bg-muted/40 p-3">
              <time className="text-overline text-muted-foreground">
                {formatPortalDate(t, update.createdAt)}
              </time>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {update.body?.trim() || t('incidents.portal.updates.emptyBody', 'Update details were not provided.')}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default function PortalIncidentsPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading: authLoading } = auth
  const [items, setItems] = React.useState<PortalIncident[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(() => new Set())
  const requestIdRef = React.useRef(0)

  React.useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [authLoading, user, router, params.orgSlug])

  const loadIncidents = React.useCallback(async () => {
    if (!user) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setIsLoading(true)
    setError(null)

    const search = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    try {
      const call = await apiCall<PortalIncidentsResponse>(`/api/incidents/portal?${search.toString()}`)
      if (requestIdRef.current !== requestId) return
      if (!call.ok || !isPortalIncidentsResponse(call.result)) {
        setItems([])
        setTotal(0)
        setError(t('incidents.portal.error.loadFailed', 'Unable to load incidents.'))
        return
      }

      setItems(call.result.items)
      setTotal(call.result.total)
    } catch {
      if (requestIdRef.current !== requestId) return
      setItems([])
      setTotal(0)
      setError(t('incidents.portal.error.loadFailed', 'Unable to load incidents.'))
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
      }
    }
  }, [page, pageSize, t, user])

  React.useEffect(() => {
    void loadIncidents()
  }, [loadIncidents])

  usePortalAppEvent(
    'incidents.incident.customer_updated',
    () => {
      void loadIncidents()
    },
    [loadIncidents],
  )

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const columns = React.useMemo<DataTableProps<PortalIncident>['columns']>(() => [
    {
      accessorKey: 'number',
      header: t('incidents.portal.columns.number', 'Number'),
      cell: ({ row }) => (
        <span className="font-medium" title={row.original.number || t('incidents.portal.unnumbered', 'Unnumbered')}>
          {row.original.number || t('incidents.portal.unnumbered', 'Unnumbered')}
        </span>
      ),
      meta: { alwaysVisible: true, truncate: true, maxWidth: 160 },
    },
    {
      accessorKey: 'title',
      header: t('incidents.portal.columns.title', 'Title'),
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-2">
          <span className="font-medium" title={row.original.title || t('incidents.portal.untitled', 'Untitled incident')}>
            {row.original.title || t('incidents.portal.untitled', 'Untitled incident')}
          </span>
          <span className="text-sm text-muted-foreground">
            {t('incidents.portal.openedAt', 'Opened {date}', {
              date: formatPortalDate(t, row.original.createdAt),
            })}
          </span>
        </div>
      ),
      meta: { alwaysVisible: true, truncate: true, maxWidth: 420 },
    },
    {
      accessorKey: 'status',
      header: t('incidents.portal.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusVariant(row.original.status)} dot>
          {statusLabel(t, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'severity',
      header: t('incidents.portal.columns.severity', 'Severity'),
      cell: ({ row }) => {
        const severity = row.original.severity
        return (
          <StatusBadge variant={severityVariant(severity?.colorToken)} dot>
            {severityLabel(t, severity)}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'updates',
      header: t('incidents.portal.columns.updates', 'Updates'),
      cell: ({ row }) => (
        <UpdatesFeed
          incident={row.original}
          expanded={expandedIds.has(row.original.id)}
          onToggle={toggleExpanded}
        />
      ),
      meta: { alwaysVisible: true, maxWidth: 520 },
    },
  ], [expandedIds, t, toggleExpanded])

  if (authLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('incidents.portal.label', 'Support')}
        title={t('incidents.portal.title', 'Incidents')}
        description={t('incidents.portal.description', 'Customer-facing updates for incidents affecting your account.')}
      />

      <DataTable<PortalIncident>
        title={t('incidents.portal.table.title', 'Your incidents')}
        columns={columns}
        data={items}
        isLoading={isLoading}
        error={error}
        disableRowClick
        refreshButton={{
          label: t('incidents.portal.refresh', 'Refresh'),
          onRefresh: () => {
            void loadIncidents()
          },
        }}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          pageSizeOptions: [10, 25, 50],
          onPageChange: setPage,
          onPageSizeChange: (nextPageSize) => {
            setPage(1)
            setPageSize(nextPageSize)
          },
        }}
        emptyState={(
          <PortalEmptyState
            icon={<AlertTriangle className="size-5" aria-hidden="true" />}
            title={t('incidents.portal.empty.title', 'No incidents')}
            description={t('incidents.portal.empty.description', 'Customer-facing incident updates will appear here when your account is affected.')}
          />
        )}
      />
    </div>
  )
}
