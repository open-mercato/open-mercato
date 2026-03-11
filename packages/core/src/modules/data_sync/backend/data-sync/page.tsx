"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Badge, type BadgeProps } from '@open-mercato/ui/primitives/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ArrowRightLeft,
  Boxes,
  CalendarClock,
  CircleAlert,
  Clock3,
  Gauge,
  Play,
  PlugZap,
  Repeat,
  Settings2,
  ShieldCheck,
} from 'lucide-react'

type SyncRunRow = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  createdCount: number
  updatedCount: number
  failedCount: number
  createdAt: string
}

type ResponsePayload = {
  items: SyncRunRow[]
  total: number
  page: number
  totalPages: number
}

type SyncOption = {
  integrationId: string
  title: string
  description?: string | null
  providerKey?: string | null
  direction: 'import' | 'export' | 'bidirectional'
  supportedEntities: string[]
  hasCredentials: boolean
  isEnabled: boolean
  settingsPath: string
}

type SyncOptionsResponse = {
  items: SyncOption[]
}

type SyncScheduleRecord = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  lastRunAt: string | null
}

type SyncSchedulesResponse = {
  items?: SyncScheduleRecord[]
}

type SyncScheduleEditorState = {
  id?: string
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  lastRunAt: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
  paused: 'bg-orange-100 text-orange-800',
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

type SummaryBadgeStyle = {
  variant: BadgeProps['variant']
  className?: string
}

function getSummaryBadgeStyle(kind: 'enabled' | 'disabled' | 'ready' | 'missing' | 'scheduled' | 'paused' | 'none'): SummaryBadgeStyle {
  if (kind === 'enabled' || kind === 'ready') {
    return {
      variant: 'outline',
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200',
    }
  }

  if (kind === 'disabled' || kind === 'missing') {
    return {
      variant: 'outline',
      className: 'border-red-500/30 bg-red-500/15 text-red-200',
    }
  }

  if (kind === 'paused') {
    return {
      variant: 'outline',
      className: 'border-amber-500/30 bg-amber-500/15 text-amber-200',
    }
  }

  if (kind === 'scheduled') {
    return {
      variant: 'outline',
      className: 'border-sky-500/30 bg-sky-500/15 text-sky-200',
    }
  }

  return {
    variant: 'outline',
    className: 'border-muted-foreground/20 bg-muted/40 text-muted-foreground',
  }
}

function formatEntityTypeLabel(entityType: string): string {
  return entityType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function buildDefaultScheduleState(entityType: string): SyncScheduleEditorState {
  const normalized = entityType.trim().toLowerCase()
  const longerInterval = normalized === 'categories' || normalized === 'attributes'
  return {
    scheduleType: 'interval',
    scheduleValue: longerInterval ? '6h' : '1h',
    timezone: DEFAULT_TIMEZONE,
    fullSync: normalized !== 'products',
    isEnabled: true,
    lastRunAt: null,
  }
}

export default function SyncRunsDashboardPage() {
  const router = useRouter()
  const [rows, setRows] = React.useState<SyncRunRow[]>([])
  const [options, setOptions] = React.useState<SyncOption[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(true)
  const [selectedIntegrationId, setSelectedIntegrationId] = React.useState('')
  const [selectedEntityType, setSelectedEntityType] = React.useState('')
  const [selectedDirection, setSelectedDirection] = React.useState<'import' | 'export'>('import')
  const [batchSize, setBatchSize] = React.useState('100')
  const [fullSync, setFullSync] = React.useState(false)
  const [scheduleEditor, setScheduleEditor] = React.useState<SyncScheduleEditorState>(() => buildDefaultScheduleState(''))
  const [isLoadingSchedule, setIsLoadingSchedule] = React.useState(false)
  const [isSavingSchedule, setIsSavingSchedule] = React.useState(false)
  const [isDeletingSchedule, setIsDeletingSchedule] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'data_sync.dashboard',
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '20')
      if (filterValues.status) params.set('status', filterValues.status as string)
      if (filterValues.direction) params.set('direction', filterValues.direction as string)
      const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
      const call = await apiCall<ResponsePayload>(
        `/api/data_sync/runs?${params.toString()}`,
        undefined,
        { fallback },
      )
      if (!call.ok) {
        flash(t('data_sync.dashboard.loadError'), 'error')
        if (!cancelled) setIsLoading(false)
        return
      }
      const payload = call.result ?? fallback
      if (!cancelled) {
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(payload.total || 0)
        setTotalPages(payload.totalPages || 1)
        setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, filterValues, reloadToken, scopeVersion, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      setIsLoadingOptions(true)
      const fallback: SyncOptionsResponse = { items: [] }
      const call = await apiCall<SyncOptionsResponse>('/api/data_sync/options', undefined, { fallback })
      if (!cancelled) {
        if (!call.ok) {
          flash(t('data_sync.dashboard.loadError'), 'error')
          setOptions([])
          setIsLoadingOptions(false)
          return
        }

        const nextItems = Array.isArray(call.result?.items) ? call.result.items : []
        setOptions(nextItems)
        setSelectedIntegrationId((current) => {
          if (current && nextItems.some((item) => item.integrationId === current)) return current
          return nextItems[0]?.integrationId ?? ''
        })
        setIsLoadingOptions(false)
      }
    }

    void loadOptions()
    return () => { cancelled = true }
  }, [scopeVersion, t])

  const selectedIntegration = React.useMemo(
    () => options.find((item) => item.integrationId === selectedIntegrationId) ?? null,
    [options, selectedIntegrationId],
  )

  const entityOptions = React.useMemo(
    () => selectedIntegration?.supportedEntities ?? [],
    [selectedIntegration],
  )

  React.useEffect(() => {
    if (!selectedIntegration) {
      setSelectedEntityType('')
      return
    }
    setSelectedEntityType((current) => (
      current && selectedIntegration.supportedEntities.includes(current)
        ? current
        : (selectedIntegration.supportedEntities[0] ?? '')
    ))
    setSelectedDirection(selectedIntegration.direction === 'export' ? 'export' : 'import')
  }, [selectedIntegration])

  React.useEffect(() => {
    if (!selectedIntegration || !selectedEntityType) {
      setScheduleEditor(buildDefaultScheduleState(selectedEntityType))
      return
    }

    const currentIntegration = selectedIntegration
    let cancelled = false
    async function loadSchedule() {
      setIsLoadingSchedule(true)
      const integrationId = currentIntegration.integrationId
      const params = new URLSearchParams({
        integrationId,
        entityType: selectedEntityType,
        direction: selectedDirection,
        page: '1',
        pageSize: '1',
      })
      const fallback: SyncSchedulesResponse = { items: [] }
      const call = await apiCall<SyncSchedulesResponse>(`/api/data_sync/schedules?${params.toString()}`, undefined, { fallback })

      if (cancelled) return

      if (!call.ok) {
        setScheduleEditor(buildDefaultScheduleState(selectedEntityType))
        setIsLoadingSchedule(false)
        return
      }

      const record = Array.isArray(call.result?.items) ? call.result?.items[0] : undefined
      if (!record) {
        setScheduleEditor(buildDefaultScheduleState(selectedEntityType))
        setIsLoadingSchedule(false)
        return
      }

      setScheduleEditor({
        id: record.id,
        scheduleType: record.scheduleType,
        scheduleValue: record.scheduleValue,
        timezone: record.timezone,
        fullSync: record.fullSync,
        isEnabled: record.isEnabled,
        lastRunAt: record.lastRunAt,
      })
      setIsLoadingSchedule(false)
    }

    void loadSchedule()
    return () => { cancelled = true }
  }, [selectedDirection, selectedEntityType, selectedIntegration, scopeVersion])

  const updateScheduleEditor = React.useCallback((changes: Partial<SyncScheduleEditorState>) => {
    setScheduleEditor((current) => ({ ...current, ...changes }))
  }, [])

  const handleCancel = React.useCallback(async (row: SyncRunRow) => {
    const call = await apiCall(`/api/data_sync/runs/${encodeURIComponent(row.id)}/cancel`, {
      method: 'POST',
    }, { fallback: null })
    if (call.ok) {
      flash(t('data_sync.runs.detail.cancelSuccess'), 'success')
      setReloadToken((token) => token + 1)
    } else {
      flash(t('data_sync.runs.detail.cancelError'), 'error')
    }
  }, [t])

  const handleRetry = React.useCallback(async (row: SyncRunRow) => {
    const call = await apiCall(`/api/data_sync/runs/${encodeURIComponent(row.id)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBeginning: false }),
    }, { fallback: null })
    if (call.ok) {
      flash(t('data_sync.runs.detail.retrySuccess'), 'success')
      setReloadToken((token) => token + 1)
    } else {
      flash(t('data_sync.runs.detail.retryError'), 'error')
    }
  }, [t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== '') next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleStartSync = React.useCallback(async () => {
    if (!selectedIntegration || !selectedEntityType) return

    const parsedBatchSize = Number.parseInt(batchSize, 10)
    if (!Number.isFinite(parsedBatchSize) || parsedBatchSize < 1 || parsedBatchSize > 1000) {
      flash(t('data_sync.dashboard.start.invalidBatchSize', 'Batch size must be between 1 and 1000.'), 'error')
      return
    }

    try {
      const call = await runMutation({
        operation: () => apiCall<{ id: string }>('/api/data_sync/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrationId: selectedIntegration.integrationId,
            entityType: selectedEntityType,
            direction: selectedDirection,
            batchSize: parsedBatchSize,
            fullSync,
          }),
        }, { fallback: null }),
        mutationPayload: {
          integrationId: selectedIntegration.integrationId,
          entityType: selectedEntityType,
          direction: selectedDirection,
          batchSize: parsedBatchSize,
          fullSync,
        },
        context: {
          operation: 'create',
          actionId: 'start-sync-run',
          integrationId: selectedIntegration.integrationId,
        },
      })

      if (!call.ok || !call.result?.id) {
        flash((call.result as { error?: string } | null)?.error ?? t('data_sync.dashboard.start.error', 'Failed to start sync run'), 'error')
        return
      }

      flash(t('data_sync.dashboard.start.success', 'Sync run started'), 'success')
      setReloadToken((token) => token + 1)
      router.push(`/backend/data-sync/runs/${encodeURIComponent(call.result.id)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.dashboard.start.error', 'Failed to start sync run')
      flash(message, 'error')
    }
  }, [batchSize, fullSync, router, runMutation, selectedDirection, selectedEntityType, selectedIntegration, t])

  const handleSaveSchedule = React.useCallback(async () => {
    if (!selectedIntegration || !selectedEntityType) return
    if (scheduleEditor.scheduleValue.trim().length === 0) {
      flash(t('data_sync.dashboard.schedule.invalidValue', 'Provide a schedule value before saving.'), 'error')
      return
    }

    setIsSavingSchedule(true)
    try {
      const call = await runMutation({
        operation: () => apiCall<SyncScheduleRecord>('/api/data_sync/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrationId: selectedIntegration.integrationId,
            entityType: selectedEntityType,
            direction: selectedDirection,
            scheduleType: scheduleEditor.scheduleType,
            scheduleValue: scheduleEditor.scheduleValue.trim(),
            timezone: scheduleEditor.timezone.trim() || DEFAULT_TIMEZONE,
            fullSync: scheduleEditor.fullSync,
            isEnabled: scheduleEditor.isEnabled,
          }),
        }, { fallback: null }),
        mutationPayload: {
          integrationId: selectedIntegration.integrationId,
          entityType: selectedEntityType,
          direction: selectedDirection,
          scheduleType: scheduleEditor.scheduleType,
          scheduleValue: scheduleEditor.scheduleValue.trim(),
          timezone: scheduleEditor.timezone.trim() || DEFAULT_TIMEZONE,
          fullSync: scheduleEditor.fullSync,
          isEnabled: scheduleEditor.isEnabled,
        },
        context: {
          operation: 'update',
          actionId: 'save-sync-schedule',
          integrationId: selectedIntegration.integrationId,
        },
      })

      if (!call.ok || !call.result) {
        flash((call.result as { error?: string } | null)?.error ?? t('data_sync.dashboard.schedule.error', 'Failed to save recurring schedule'), 'error')
        return
      }

      setScheduleEditor({
        id: call.result.id,
        scheduleType: call.result.scheduleType,
        scheduleValue: call.result.scheduleValue,
        timezone: call.result.timezone,
        fullSync: call.result.fullSync,
        isEnabled: call.result.isEnabled,
        lastRunAt: call.result.lastRunAt,
      })
      flash(t('data_sync.dashboard.schedule.success', 'Recurring schedule saved'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.dashboard.schedule.error', 'Failed to save recurring schedule')
      flash(message, 'error')
    } finally {
      setIsSavingSchedule(false)
    }
  }, [runMutation, scheduleEditor, selectedDirection, selectedEntityType, selectedIntegration, t])

  const handleDeleteSchedule = React.useCallback(async () => {
    if (!scheduleEditor.id) return

    setIsDeletingSchedule(true)
    try {
      const call = await runMutation({
        operation: () => apiCall(`/api/data_sync/schedules/${encodeURIComponent(scheduleEditor.id as string)}`, {
          method: 'DELETE',
        }, { fallback: null }),
        mutationPayload: {
          scheduleId: scheduleEditor.id,
        },
        context: {
          operation: 'delete',
          actionId: 'delete-sync-schedule',
        },
      })

      if (!call.ok) {
        flash((call.result as { error?: string } | null)?.error ?? t('data_sync.dashboard.schedule.deleteError', 'Failed to remove recurring schedule'), 'error')
        return
      }

      setScheduleEditor(buildDefaultScheduleState(selectedEntityType))
      flash(t('data_sync.dashboard.schedule.deleteSuccess', 'Recurring schedule removed'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.dashboard.schedule.deleteError', 'Failed to remove recurring schedule')
      flash(message, 'error')
    } finally {
      setIsDeletingSchedule(false)
    }
  }, [runMutation, scheduleEditor.id, selectedEntityType, t])

  const filters: FilterDef[] = [
    {
      id: 'status',
      type: 'select',
      label: t('data_sync.dashboard.filters.status'),
      options: [
        { label: t('data_sync.dashboard.filters.allStatuses'), value: '' },
        { label: t('data_sync.dashboard.status.pending'), value: 'pending' },
        { label: t('data_sync.dashboard.status.running'), value: 'running' },
        { label: t('data_sync.dashboard.status.completed'), value: 'completed' },
        { label: t('data_sync.dashboard.status.failed'), value: 'failed' },
        { label: t('data_sync.dashboard.status.cancelled'), value: 'cancelled' },
      ],
    },
    {
      id: 'direction',
      type: 'select',
      label: t('data_sync.dashboard.columns.direction'),
      options: [
        { label: t('data_sync.dashboard.filters.allDirections'), value: '' },
        { label: t('data_sync.dashboard.direction.import'), value: 'import' },
        { label: t('data_sync.dashboard.direction.export'), value: 'export' },
      ],
    },
  ]

  const columns = React.useMemo<ColumnDef<SyncRunRow>[]>(() => [
    {
      accessorKey: 'integrationId',
      header: t('data_sync.dashboard.columns.integration'),
      cell: ({ row }) => <span className="font-medium text-sm">{row.original.integrationId}</span>,
    },
    {
      accessorKey: 'entityType',
      header: t('data_sync.dashboard.columns.entityType'),
    },
    {
      accessorKey: 'direction',
      header: t('data_sync.dashboard.columns.direction'),
      cell: ({ row }) => (
        <Badge variant="outline">
          {t(`data_sync.dashboard.direction.${row.original.direction}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: t('data_sync.dashboard.columns.status'),
      cell: ({ row }) => (
        <Badge variant="secondary" className={STATUS_STYLES[row.original.status] ?? ''}>
          {t(`data_sync.dashboard.status.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdCount',
      header: t('data_sync.dashboard.columns.created'),
    },
    {
      accessorKey: 'updatedCount',
      header: t('data_sync.dashboard.columns.updated'),
    },
    {
      accessorKey: 'failedCount',
      header: t('data_sync.dashboard.columns.failed'),
    },
    {
      accessorKey: 'createdAt',
      header: t('data_sync.dashboard.columns.createdAt'),
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
    },
  ], [t])

  const canStartSelectedIntegration = Boolean(
    selectedIntegration
    && selectedEntityType
    && selectedIntegration.isEnabled
    && selectedIntegration.hasCredentials,
  )
  const hasSavedSchedule = Boolean(scheduleEditor.id)
  const selectedEntityLabel = selectedEntityType ? formatEntityTypeLabel(selectedEntityType) : t('data_sync.dashboard.columns.entityType')
  const integrationStateBadge = getSummaryBadgeStyle(selectedIntegration?.isEnabled ? 'enabled' : 'disabled')
  const credentialsBadge = getSummaryBadgeStyle(selectedIntegration?.hasCredentials ? 'ready' : 'missing')
  const scheduleBadge = getSummaryBadgeStyle(
    hasSavedSchedule
      ? (scheduleEditor.isEnabled ? 'scheduled' : 'paused')
      : 'none',
  )

  return (
    <Page>
      <PageBody className="space-y-6">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <Repeat className="size-4" />
                  <span>{t('data_sync.dashboard.start.eyebrow', 'Run once or keep it recurring')}</span>
                </div>
                <div className="space-y-1">
                  <CardTitle>{t('data_sync.dashboard.start.title', 'Start or schedule a sync')}</CardTitle>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    {t('data_sync.dashboard.start.description', 'Pick a sync target, launch an ad-hoc run, or save a recurring schedule for the same entity and direction from this page.')}
                  </p>
                </div>
              </div>
              {selectedIntegration ? (
                <Button asChild variant="outline">
                  <Link href={selectedIntegration.settingsPath}>
                    <Settings2 className="mr-2 size-4" />
                    {t('integrations.marketplace.configure')}
                  </Link>
                </Button>
              ) : null}
            </div>

            {selectedIntegration ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1.5">
                  <PlugZap className="size-3.5" />
                  {selectedIntegration.title}
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <ArrowRightLeft className="size-3.5" />
                  {t(`data_sync.dashboard.direction.${selectedDirection}`)}
                </Badge>
                <Badge variant={integrationStateBadge.variant} className={`gap-1.5 ${integrationStateBadge.className ?? ''}`}>
                  <ShieldCheck className="size-3.5" />
                  {selectedIntegration.isEnabled
                    ? t('data_sync.dashboard.start.status.enabled', 'Integration enabled')
                    : t('data_sync.dashboard.start.status.disabled', 'Integration disabled')}
                </Badge>
                <Badge variant={credentialsBadge.variant} className={`gap-1.5 ${credentialsBadge.className ?? ''}`}>
                  <PlugZap className="size-3.5" />
                  {selectedIntegration.hasCredentials
                    ? t('data_sync.dashboard.start.status.credentialsReady', 'Credentials ready')
                    : t('data_sync.dashboard.start.status.credentialsMissing', 'Credentials missing')}
                </Badge>
                <Badge variant={scheduleBadge.variant} className={`gap-1.5 ${scheduleBadge.className ?? ''}`}>
                  <CalendarClock className="size-3.5" />
                  {hasSavedSchedule
                    ? (scheduleEditor.isEnabled
                      ? t('data_sync.dashboard.schedule.status.enabled', 'Recurring schedule active')
                      : t('data_sync.dashboard.schedule.status.disabled', 'Recurring schedule paused'))
                    : t('data_sync.dashboard.schedule.status.none', 'No recurring schedule')}
                </Badge>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="space-y-2 xl:col-span-1">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <PlugZap className="size-4 text-muted-foreground" />
                  <span>{t('data_sync.dashboard.columns.integration')}</span>
                </Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedIntegrationId}
                  onChange={(event) => setSelectedIntegrationId(event.target.value)}
                  disabled={isLoadingOptions || options.length === 0}
                >
                  {options.length === 0 ? (
                    <option value="">{t('integrations.marketplace.noResults', 'No integrations found')}</option>
                  ) : null}
                  {options.map((item) => (
                    <option key={item.integrationId} value={item.integrationId}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Boxes className="size-4 text-muted-foreground" />
                  <span>{t('data_sync.dashboard.columns.entityType')}</span>
                </Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedEntityType}
                  onChange={(event) => setSelectedEntityType(event.target.value)}
                  disabled={entityOptions.length === 0}
                >
                  {entityOptions.map((entityType) => (
                    <option key={entityType} value={entityType}>
                      {formatEntityTypeLabel(entityType)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <ArrowRightLeft className="size-4 text-muted-foreground" />
                  <span>{t('data_sync.dashboard.columns.direction')}</span>
                </Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedDirection}
                  onChange={(event) => setSelectedDirection(event.target.value === 'export' ? 'export' : 'import')}
                  disabled={selectedIntegration?.direction !== 'bidirectional'}
                >
                  <option value="import">{t('data_sync.dashboard.direction.import')}</option>
                  {(selectedIntegration?.direction === 'bidirectional' || selectedIntegration?.direction === 'export') ? (
                    <option value="export">{t('data_sync.dashboard.direction.export')}</option>
                  ) : null}
                </select>
              </div>
            </div>

            {selectedIntegration?.description ? (
              <p className="text-sm text-muted-foreground">{selectedIntegration.description}</p>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Play className="size-4 text-primary" />
                      <h3 className="text-sm font-semibold">{t('data_sync.dashboard.start.runNowTitle', 'Run once now')}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('data_sync.dashboard.start.runNowDescription', 'Use this for the next immediate sync. Batch size and full-sync mode apply only to this manual run.')}
                    </p>
                  </div>
                  <Badge variant="outline">{selectedEntityLabel}</Badge>
                </div>

                <Separator className="my-4" />

                <div className="grid gap-4 sm:grid-cols-[minmax(0,180px)_1fr]">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Gauge className="size-4 text-muted-foreground" />
                      <span>{t('data_sync.dashboard.start.batchSize', 'Batch size')}</span>
                    </Label>
                    <Input
                      value={batchSize}
                      onChange={(event) => setBatchSize(event.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">{t('data_sync.dashboard.start.fullSync', 'Run as full sync')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('data_sync.dashboard.start.fullSyncHelp', 'Ignore the saved cursor and process the entire source again for this run.')}
                        </p>
                      </div>
                      <Switch checked={fullSync} onCheckedChange={setFullSync} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {t('data_sync.dashboard.start.runNowFootnote', 'Manual runs show progress immediately and land on the run detail page after launch.')}
                  </p>
                  <Button
                    type="button"
                    onClick={() => void handleStartSync()}
                    disabled={!canStartSelectedIntegration}
                  >
                    <Play className="mr-2 size-4" />
                    {t('data_sync.dashboard.start.submit', 'Start sync')}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="size-4 text-primary" />
                      <h3 className="text-sm font-semibold">{t('data_sync.dashboard.schedule.title', 'Recurring schedule')}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('data_sync.dashboard.schedule.description', 'Save a repeating schedule for the selected integration, entity, and direction without leaving this dashboard.')}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {hasSavedSchedule
                      ? (scheduleEditor.isEnabled
                        ? t('data_sync.dashboard.schedule.status.shortEnabled', 'Scheduled')
                        : t('data_sync.dashboard.schedule.status.shortDisabled', 'Paused'))
                      : t('data_sync.dashboard.schedule.status.shortNone', 'One-time only')}
                  </Badge>
                </div>

                <Separator className="my-4" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Clock3 className="size-4 text-muted-foreground" />
                      <span>{t('data_sync.dashboard.schedule.type', 'Schedule type')}</span>
                    </Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={scheduleEditor.scheduleType}
                      onChange={(event) => updateScheduleEditor({
                        scheduleType: event.target.value === 'cron' ? 'cron' : 'interval',
                      })}
                      disabled={isLoadingSchedule || isSavingSchedule || isDeletingSchedule || !selectedIntegration || !selectedEntityType}
                    >
                      <option value="interval">{t('data_sync.dashboard.schedule.interval', 'Interval')}</option>
                      <option value="cron">{t('data_sync.dashboard.schedule.cron', 'Cron')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <CalendarClock className="size-4 text-muted-foreground" />
                      <span>
                        {scheduleEditor.scheduleType === 'cron'
                          ? t('data_sync.dashboard.schedule.cronValue', 'Cron expression')
                          : t('data_sync.dashboard.schedule.intervalValue', 'Interval')}
                      </span>
                    </Label>
                    <Input
                      value={scheduleEditor.scheduleValue}
                      onChange={(event) => updateScheduleEditor({ scheduleValue: event.target.value })}
                      disabled={isLoadingSchedule || isSavingSchedule || isDeletingSchedule || !selectedIntegration || !selectedEntityType}
                      placeholder={scheduleEditor.scheduleType === 'cron' ? '0 * * * *' : '1h'}
                    />
                    <p className="text-xs text-muted-foreground">
                      {scheduleEditor.scheduleType === 'cron'
                        ? t('data_sync.dashboard.schedule.cronHelp', 'Example: `0 * * * *` runs at the start of every hour.')
                        : t('data_sync.dashboard.schedule.intervalHelp', 'Example: `1h`, `6h`, or `24h` for repeating intervals.')}
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Clock3 className="size-4 text-muted-foreground" />
                      <span>{t('data_sync.dashboard.schedule.timezone', 'Timezone')}</span>
                    </Label>
                    <Input
                      value={scheduleEditor.timezone}
                      onChange={(event) => updateScheduleEditor({ timezone: event.target.value })}
                      disabled={isLoadingSchedule || isSavingSchedule || isDeletingSchedule || !selectedIntegration || !selectedEntityType}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">{t('data_sync.dashboard.schedule.fullSync', 'Run scheduled jobs as full sync')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('data_sync.dashboard.schedule.fullSyncHelp', 'When enabled, every recurring run starts from the beginning instead of the saved cursor.')}
                        </p>
                      </div>
                      <Switch
                        checked={scheduleEditor.fullSync}
                        onCheckedChange={(checked) => updateScheduleEditor({ fullSync: checked })}
                        disabled={isLoadingSchedule || isSavingSchedule || isDeletingSchedule || !selectedIntegration || !selectedEntityType}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">{t('data_sync.dashboard.schedule.enabled', 'Schedule enabled')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('data_sync.dashboard.schedule.enabledHelp', 'Pause the recurring job without deleting the schedule definition.')}
                        </p>
                      </div>
                      <Switch
                        checked={scheduleEditor.isEnabled}
                        onCheckedChange={(checked) => updateScheduleEditor({ isEnabled: checked })}
                        disabled={isLoadingSchedule || isSavingSchedule || isDeletingSchedule || !selectedIntegration || !selectedEntityType}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      {hasSavedSchedule
                        ? (scheduleEditor.lastRunAt
                          ? t('data_sync.dashboard.schedule.lastRun', 'Last scheduled run: {value}', {
                              value: new Date(scheduleEditor.lastRunAt).toLocaleString(),
                            })
                          : t('data_sync.dashboard.schedule.neverRun', 'Saved, but no scheduled execution has completed yet.'))
                        : t('data_sync.dashboard.schedule.none', 'No recurring schedule saved for this target yet.')}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleDeleteSchedule()}
                      disabled={!hasSavedSchedule || isDeletingSchedule}
                    >
                      {isDeletingSchedule
                        ? t('data_sync.dashboard.schedule.deleting', 'Removing...')
                        : t('data_sync.dashboard.schedule.delete', 'Remove schedule')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSaveSchedule()}
                      disabled={isSavingSchedule || !selectedIntegration || !selectedEntityType}
                    >
                      <CalendarClock className="mr-2 size-4" />
                      {isSavingSchedule
                        ? t('data_sync.dashboard.schedule.saving', 'Saving...')
                        : t('data_sync.dashboard.schedule.save', 'Save recurring schedule')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {selectedIntegration && !selectedIntegration.isEnabled ? (
              <Notice compact variant="warning">
                <span className="inline-flex items-center gap-2">
                  <CircleAlert className="size-4" />
                  <span>{t('integrations.detail.state.disabled', 'This integration is disabled. Enable it on the integration settings page before starting a sync.')}</span>
                </span>
              </Notice>
            ) : null}
            {selectedIntegration && !selectedIntegration.hasCredentials ? (
              <Notice compact variant="warning">
                <span className="inline-flex items-center gap-2">
                  <CircleAlert className="size-4" />
                  <span>{t('integrations.detail.credentials.notConfigured', 'Credentials are not configured yet. Save the integration credentials before starting a sync.')}</span>
                </span>
              </Notice>
            ) : null}
          </CardContent>
        </Card>

        <DataTable
          title={t('data_sync.dashboard.title')}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          perspective={{ tableId: 'data_sync.runs' }}
          onRowClick={(row) => {
            router.push(`/backend/data-sync/runs/${encodeURIComponent(row.id)}`)
          }}
          rowActions={(row) => (
            <RowActions items={[
              {
                id: 'view',
                label: t('data_sync.dashboard.actions.view'),
                onSelect: () => { router.push(`/backend/data-sync/runs/${encodeURIComponent(row.id)}`) },
              },
              ...(row.status === 'running' ? [{
                id: 'cancel',
                label: t('data_sync.runs.detail.cancel'),
                destructive: true,
                onSelect: () => { void handleCancel(row) },
              }] : []),
              ...(row.status === 'failed' ? [{
                id: 'retry',
                label: t('data_sync.runs.detail.retry'),
                onSelect: () => { void handleRetry(row) },
              }] : []),
            ]} />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
