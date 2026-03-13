"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CalendarClock,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react'

type SyncOption = {
  integrationId: string
  title: string
  direction: 'import' | 'export' | 'bidirectional'
  supportedEntities: string[]
  hasCredentials: boolean
  isEnabled: boolean
}

type SyncOptionsResponse = {
  items?: SyncOption[]
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

type IntegrationScheduleTabProps = {
  integrationId: string
  hasCredentials: boolean
  isEnabled: boolean
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

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

function getSupportedDirections(direction: SyncOption['direction'] | null | undefined): Array<'import' | 'export'> {
  if (direction === 'export') return ['export']
  if (direction === 'bidirectional') return ['import', 'export']
  return ['import']
}

function buildScheduleKey(entityType: string, direction: 'import' | 'export'): string {
  return `${entityType}:${direction}`
}

function buildScheduleEditors(
  entityTypes: string[],
  directions: Array<'import' | 'export'>,
  records: SyncScheduleRecord[],
): Record<string, SyncScheduleEditorState> {
  const nextEntries: Array<[string, SyncScheduleEditorState]> = []
  for (const entityType of entityTypes) {
    for (const direction of directions) {
      const record = records.find((item) => item.entityType === entityType && item.direction === direction)
      nextEntries.push([
        buildScheduleKey(entityType, direction),
        record
          ? {
            id: record.id,
            scheduleType: record.scheduleType,
            scheduleValue: record.scheduleValue,
            timezone: record.timezone,
            fullSync: record.fullSync,
            isEnabled: record.isEnabled,
            lastRunAt: record.lastRunAt,
          }
          : buildDefaultScheduleState(entityType),
      ])
    }
  }
  return Object.fromEntries(nextEntries)
}

export function IntegrationScheduleTab(props: IntegrationScheduleTabProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [option, setOption] = React.useState<SyncOption | null>(null)
  const [schedules, setSchedules] = React.useState<Record<string, SyncScheduleEditorState>>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [runningKey, setRunningKey] = React.useState<string | null>(null)
  const [savingKey, setSavingKey] = React.useState<string | null>(null)
  const [deletingKey, setDeletingKey] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [optionsCall, schedulesCall] = await Promise.all([
        apiCall<SyncOptionsResponse>('/api/data_sync/options', undefined, { fallback: { items: [] } }),
        apiCall<SyncSchedulesResponse>(`/api/data_sync/schedules?integrationId=${encodeURIComponent(props.integrationId)}&page=1&pageSize=100`, undefined, { fallback: { items: [] } }),
      ])

      const resolvedOption = (optionsCall.result?.items ?? []).find((item) => item.integrationId === props.integrationId) ?? null
      setOption(resolvedOption)

      const supportedEntities = resolvedOption?.supportedEntities ?? []
      const supportedDirections = getSupportedDirections(resolvedOption?.direction)
      setSchedules(buildScheduleEditors(supportedEntities, supportedDirections, schedulesCall.result?.items ?? []))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.integrationTab.loadError', 'Failed to load sync schedules.')
      flash(message, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [props.integrationId, t])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  const supportedDirections = React.useMemo(
    () => getSupportedDirections(option?.direction),
    [option?.direction],
  )

  const rows = React.useMemo(
    () => (option?.supportedEntities ?? []).flatMap((entityType) => (
      supportedDirections.map((direction) => ({
        entityType,
        direction,
        key: buildScheduleKey(entityType, direction),
      }))
    )),
    [option?.supportedEntities, supportedDirections],
  )

  const updateScheduleEditor = React.useCallback((key: string, patch: Partial<SyncScheduleEditorState>, entityType: string) => {
    setSchedules((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? buildDefaultScheduleState(entityType)),
        ...patch,
      },
    }))
  }, [])

  const handleStartSync = React.useCallback(async (entityType: string, direction: 'import' | 'export', scheduleKey: string) => {
    if (!props.isEnabled) {
      flash(t('data_sync.integrationTab.integrationDisabled', 'Enable the integration before starting a sync.'), 'error')
      return
    }
    if (!props.hasCredentials) {
      flash(t('data_sync.integrationTab.credentialsMissing', 'Configure credentials before starting a sync.'), 'error')
      return
    }

    setRunningKey(scheduleKey)
    try {
      const scheduleState = schedules[scheduleKey] ?? buildDefaultScheduleState(entityType)
      const call = await apiCall<{ id: string }>('/api/data_sync/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: props.integrationId,
          entityType,
          direction,
          fullSync: scheduleState.fullSync,
          batchSize: 100,
        }),
      }, { fallback: null })

      if (!call.ok) {
        throw new Error((call.result as { error?: string } | null)?.error ?? 'Failed to start sync')
      }

      flash(t('data_sync.integrationTab.runStarted', 'Sync run started.'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.integrationTab.runError', 'Failed to start sync.')
      flash(message, 'error')
    } finally {
      setRunningKey(null)
    }
  }, [props.hasCredentials, props.integrationId, props.isEnabled, schedules, t])

  const handleSaveSchedule = React.useCallback(async (entityType: string, direction: 'import' | 'export', scheduleKey: string) => {
    const scheduleState = schedules[scheduleKey] ?? buildDefaultScheduleState(entityType)
    setSavingKey(scheduleKey)
    try {
      const call = await apiCall<SyncScheduleRecord>('/api/data_sync/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: props.integrationId,
          entityType,
          direction,
          scheduleType: scheduleState.scheduleType,
          scheduleValue: scheduleState.scheduleValue,
          timezone: scheduleState.timezone,
          fullSync: scheduleState.fullSync,
          isEnabled: scheduleState.isEnabled,
        }),
      }, { fallback: null })

      if (!call.ok || !call.result) {
        throw new Error((call.result as { error?: string } | null)?.error ?? 'Failed to save schedule')
      }

      updateScheduleEditor(scheduleKey, {
        id: call.result.id,
        scheduleType: call.result.scheduleType,
        scheduleValue: call.result.scheduleValue,
        timezone: call.result.timezone,
        fullSync: call.result.fullSync,
        isEnabled: call.result.isEnabled,
        lastRunAt: call.result.lastRunAt,
      }, entityType)
      flash(t('data_sync.dashboard.schedule.success', 'Recurring schedule saved'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.dashboard.schedule.error', 'Failed to save recurring schedule')
      flash(message, 'error')
    } finally {
      setSavingKey(null)
    }
  }, [props.integrationId, schedules, t, updateScheduleEditor])

  const handleDeleteSchedule = React.useCallback(async (entityType: string, scheduleKey: string) => {
    const scheduleState = schedules[scheduleKey]
    if (!scheduleState?.id) {
      updateScheduleEditor(scheduleKey, buildDefaultScheduleState(entityType), entityType)
      return
    }

    setDeletingKey(scheduleKey)
    try {
      const call = await apiCall(`/api/data_sync/schedules/${encodeURIComponent(scheduleState.id)}`, {
        method: 'DELETE',
      }, { fallback: null })

      if (!call.ok) {
        throw new Error((call.result as { error?: string } | null)?.error ?? 'Failed to delete schedule')
      }

      setSchedules((current) => ({
        ...current,
        [scheduleKey]: buildDefaultScheduleState(entityType),
      }))
      flash(t('data_sync.dashboard.schedule.deleteSuccess', 'Recurring schedule removed'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.dashboard.schedule.deleteError', 'Failed to remove recurring schedule')
      flash(message, 'error')
    } finally {
      setDeletingKey(null)
    }
  }, [schedules, t, updateScheduleEditor])

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border bg-card">
        <Spinner />
      </div>
    )
  }

  if (!option) {
    return (
      <Notice compact variant="warning">
        {t('data_sync.integrationTab.notAvailable', 'This integration is not registered as a data sync provider.')}
      </Notice>
    )
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={props.isEnabled ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}>
              {props.isEnabled ? <ShieldCheck className="mr-2 h-3.5 w-3.5" /> : <ShieldAlert className="mr-2 h-3.5 w-3.5" />}
              {props.isEnabled
                ? t('data_sync.dashboard.start.status.enabled', 'Integration enabled')
                : t('data_sync.dashboard.start.status.disabled', 'Integration disabled')}
            </Badge>
            <Badge variant="outline" className={props.hasCredentials ? 'border-sky-300 text-sky-700' : 'border-amber-300 text-amber-700'}>
              <CalendarClock className="mr-2 h-3.5 w-3.5" />
              {props.hasCredentials
                ? t('data_sync.dashboard.start.status.credentialsReady', 'Credentials ready')
                : t('data_sync.dashboard.start.status.credentialsMissing', 'Credentials missing')}
            </Badge>
          </div>
          <div>
            <h3 className="text-base font-semibold">{t('data_sync.integrationTab.title', 'Sync schedules')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('data_sync.integrationTab.description', 'Run one-off syncs or save recurring schedules for every supported entity directly from the integration detail page.')}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('data_sync.integrationTab.refresh', 'Refresh')}
        </Button>
      </div>

      {!props.isEnabled ? (
        <Notice compact variant="warning">
          {t('data_sync.integrationTab.integrationDisabledNotice', 'The integration is disabled. You can save schedules now, but runs will stay blocked until the integration is enabled.')}
        </Notice>
      ) : null}

      {!props.hasCredentials ? (
        <Notice compact variant="warning">
          {t('data_sync.integrationTab.credentialsMissingNotice', 'Credentials are still missing. Save schedules first if you want, but manual and scheduled runs will fail until credentials are configured.')}
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <Notice compact>
          {t('data_sync.integrationTab.empty', 'This provider does not expose any schedulable sync entities yet.')}
        </Notice>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('data_sync.dashboard.columns.entityType', 'Entity Type')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.dashboard.columns.direction', 'Direction')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.dashboard.schedule.type', 'Schedule type')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.integrationTab.columns.value', 'Value')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.dashboard.schedule.timezone', 'Timezone')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.dashboard.start.fullSync', 'Run as full sync')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.dashboard.schedule.enabled', 'Schedule enabled')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.integrationTab.columns.lastRun', 'Last run')}</th>
                <th className="px-3 py-2 font-medium">{t('data_sync.integrationTab.columns.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const scheduleState = schedules[row.key] ?? buildDefaultScheduleState(row.entityType)
                const isRunning = runningKey === row.key
                const isSaving = savingKey === row.key
                const isDeleting = deletingKey === row.key
                const controlsDisabled = isRunning || isSaving || isDeleting
                return (
                  <tr key={row.key} className="border-t align-top">
                    <td className="px-3 py-3 font-medium">{formatEntityTypeLabel(row.entityType)}</td>
                    <td className="px-3 py-3">{t(`data_sync.dashboard.direction.${row.direction}`, row.direction === 'import' ? 'Import' : 'Export')}</td>
                    <td className="px-3 py-3">
                      <select
                        className="flex h-10 w-full min-w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={scheduleState.scheduleType}
                        onChange={(event) => updateScheduleEditor(row.key, {
                          scheduleType: event.target.value === 'cron' ? 'cron' : 'interval',
                        }, row.entityType)}
                        disabled={controlsDisabled}
                      >
                        <option value="interval">{t('data_sync.dashboard.schedule.interval', 'Interval')}</option>
                        <option value="cron">{t('data_sync.dashboard.schedule.cron', 'Cron')}</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        value={scheduleState.scheduleValue}
                        onChange={(event) => updateScheduleEditor(row.key, { scheduleValue: event.target.value }, row.entityType)}
                        disabled={controlsDisabled}
                        placeholder={scheduleState.scheduleType === 'cron' ? '0 * * * *' : '1h'}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        value={scheduleState.timezone}
                        onChange={(event) => updateScheduleEditor(row.key, { timezone: event.target.value }, row.entityType)}
                        disabled={controlsDisabled}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <label className="flex min-h-10 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={scheduleState.fullSync}
                          onChange={(event) => updateScheduleEditor(row.key, { fullSync: event.target.checked }, row.entityType)}
                          disabled={controlsDisabled}
                        />
                        <span>{t('data_sync.integrationTab.fullSyncShort', 'Full')}</span>
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <label className="flex min-h-10 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={scheduleState.isEnabled}
                          onChange={(event) => updateScheduleEditor(row.key, { isEnabled: event.target.checked }, row.entityType)}
                          disabled={controlsDisabled}
                        />
                        <span>{scheduleState.isEnabled ? t('data_sync.dashboard.schedule.status.shortEnabled', 'Scheduled') : t('data_sync.dashboard.schedule.status.shortDisabled', 'Paused')}</span>
                      </label>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {scheduleState.lastRunAt
                        ? new Date(scheduleState.lastRunAt).toLocaleString()
                        : scheduleState.id
                          ? t('data_sync.dashboard.schedule.neverRun', 'Saved, but no scheduled execution has completed yet.')
                          : t('data_sync.dashboard.schedule.none', 'No recurring schedule saved for this target yet.')}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleStartSync(row.entityType, row.direction, row.key)}
                          disabled={controlsDisabled || !props.isEnabled || !props.hasCredentials}
                        >
                          {isRunning ? <Spinner className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                          {isRunning
                            ? t('data_sync.integrationTab.starting', 'Starting...')
                            : t('data_sync.integrationTab.start', 'Run now')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleSaveSchedule(row.entityType, row.direction, row.key)}
                          disabled={controlsDisabled}
                        >
                          {isSaving ? <Spinner className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                          {isSaving
                            ? t('data_sync.dashboard.schedule.saving', 'Saving...')
                            : t('data_sync.dashboard.schedule.save', 'Save recurring schedule')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleDeleteSchedule(row.entityType, row.key)}
                          disabled={controlsDisabled || !scheduleState.id}
                        >
                          {isDeleting ? <Spinner className="mr-2 h-4 w-4" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          {isDeleting
                            ? t('data_sync.dashboard.schedule.deleting', 'Removing...')
                            : t('data_sync.dashboard.schedule.delete', 'Remove schedule')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground md:grid-cols-3">
        <div className="space-y-1">
          <Label>{t('data_sync.dashboard.schedule.interval', 'Interval')}</Label>
          <p>{t('data_sync.dashboard.schedule.intervalHelp', 'Example: `1h`, `6h`, or `24h` for repeating intervals.')}</p>
        </div>
        <div className="space-y-1">
          <Label>{t('data_sync.dashboard.schedule.cron', 'Cron')}</Label>
          <p>{t('data_sync.dashboard.schedule.cronHelp', 'Example: `0 * * * *` runs at the start of every hour.')}</p>
        </div>
        <div className="space-y-1">
          <Label>{t('data_sync.integrationTab.runNowTitle', 'Manual runs')}</Label>
          <p>{t('data_sync.integrationTab.runNowHelp', 'Run now uses the full-sync checkbox from the same row and starts progress tracking immediately in Data Sync.')}</p>
        </div>
      </div>
    </section>
  )
}

export default IntegrationScheduleTab
