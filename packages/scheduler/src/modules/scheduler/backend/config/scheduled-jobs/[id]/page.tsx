"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Label } from '@open-mercato/ui/primitives/label'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { JobLogsModal } from '../../../../components/JobLogsModal'
import { ExecutionDetailsDialog } from '../../../../components/ExecutionDetailsDialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'

type ScheduleDetail = {
  id: string
  name: string
  description?: string
  scopeType: 'system' | 'organization' | 'tenant'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue' | 'command'
  targetQueue?: string
  targetCommand?: string
  targetPayload?: Record<string, unknown>
  requireFeature?: string
  isEnabled: boolean
  lastRunAt?: string
  nextRunAt?: string
  sourceType: 'user' | 'module'
  sourceModule?: string
}

type ExecutionRun = {
  id: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'completed' | 'failed' | 'skipped'
  triggerType: 'scheduled' | 'manual'
  queueJobId?: string
  queueName?: string
  errorMessage?: string
  errorStack?: string
  durationMs?: number
}

export default function ScheduleDetailPage() {
  const params = useParams()
  const router = useRouter()
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  // Extract schedule ID from either params.id or params.slug
  // When using catch-all routes, the ID is in params.slug[2]
  const scheduleId = params.id 
    ? (Array.isArray(params.id) ? params.id[0] : params.id)
    : (Array.isArray(params.slug) && params.slug.length >= 3 ? params.slug[2] : undefined)

  const [schedule, setSchedule] = React.useState<ScheduleDetail | null>(null)
  const [runs, setRuns] = React.useState<ExecutionRun[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [logsModalOpen, setLogsModalOpen] = React.useState(false)
  const [detailsModalOpen, setDetailsModalOpen] = React.useState(false)
  const [selectedRun, setSelectedRun] = React.useState<ExecutionRun | null>(null)
  const [triggering, setTriggering] = React.useState(false)
  const [toggling, setToggling] = React.useState(false)

  const queueStrategy = process.env.NEXT_PUBLIC_QUEUE_STRATEGY || 'local'
  const isAsyncStrategy = queueStrategy === 'async'

  const fetchScheduleAndRuns = React.useCallback(async () => {
    if (!scheduleId) return
    
    try {
      // Fetch schedule details via list API with ID filter
      const { result: listData } = await apiCallOrThrow(
        `/api/scheduler/jobs?id=${scheduleId}&page=1&pageSize=1`
      )
      const schedules = (listData as { items?: unknown[] })?.items || []
      if (schedules.length === 0) {
        throw new Error(t('scheduler.error.not_found', 'Schedule not found'))
      }
      setSchedule(schedules[0] as ScheduleDetail)

      // Fetch recent runs from BullMQ
      const { result: runsData } = await apiCallOrThrow(
        `/api/scheduler/jobs/${scheduleId}/executions?pageSize=10`
      )
      setRuns((runsData as { items?: ExecutionRun[] }).items || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('scheduler.error.load_failed', 'Failed to load schedule'))
    } finally {
      setLoading(false)
    }
  }, [scheduleId])

  React.useEffect(() => {
    if (scheduleId) {
      fetchScheduleAndRuns()
    }
  }, [scheduleId, fetchScheduleAndRuns])

  const handleTriggerNow = async () => {
    if (!scheduleId || !schedule) return
    
    // Confirm before triggering
    const targetTypeLabel =
      schedule.targetType === 'queue'
        ? t('scheduler.target.queue', 'queue job')
        : t('scheduler.target.command', 'command')
    const triggerConfirmText = t(
      'scheduler.confirm.trigger',
      'Are you sure you want to trigger "{name}" now?\n\nThis will execute the {targetType} immediately.',
      { name: schedule.name, targetType: targetTypeLabel }
    )
    const confirmed = await confirm({
      title: t('scheduler.action.trigger', 'Trigger Now'),
      text: triggerConfirmText,
    })
    
    if (!confirmed) return
    
    setTriggering(true)
    try {
      await apiCallOrThrow(`/api/scheduler/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scheduleId }),
      })
      flash(t('scheduler.success.triggered', 'Schedule triggered successfully'), 'success')
      await fetchScheduleAndRuns()
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : t('scheduler.error.trigger_failed', 'Failed to trigger schedule'), 'error')
    } finally {
      setTriggering(false)
    }
  }

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!schedule || !scheduleId) return
    setToggling(true)
    try {
      await apiCallOrThrow(`/api/scheduler/jobs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scheduleId, isEnabled: enabled }),
      })
      flash(enabled ? t('scheduler.success.enabled', 'Schedule enabled') : t('scheduler.success.disabled', 'Schedule disabled'), 'success')
      await fetchScheduleAndRuns()
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : t('scheduler.error.update_failed', 'Failed to update schedule'), 'error')
    } finally {
      setToggling(false)
    }
  }

  const handleViewLogs = (run: ExecutionRun) => {
    setSelectedRun(run)
    setLogsModalOpen(true)
  }

  const handleViewDetails = (run: ExecutionRun) => {
    setSelectedRun(run)
    setDetailsModalOpen(true)
  }

  const runsColumns: ColumnDef<ExecutionRun>[] = [
    {
      accessorKey: 'startedAt',
      header: t('scheduler.execution.started', 'Started'),
      cell: ({ row }) => (
        <div>
          <div className="text-sm">{new Date(row.original.startedAt).toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(row.original.startedAt), { addSuffix: true })}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: t('scheduler.execution.status', 'Status'),
      cell: ({ row }) => (
        <Badge variant={
          row.original.status === 'completed' ? 'default' :
          row.original.status === 'failed' ? 'destructive' :
          row.original.status === 'skipped' ? 'secondary' : 'outline'
        }>
          {t(`scheduler.execution_status.${row.original.status}`, row.original.status)}
        </Badge>
      ),
    },
    {
      accessorKey: 'durationMs',
      header: t('scheduler.execution.duration', 'Duration'),
      cell: ({ row }) => 
        row.original.durationMs 
          ? `${(row.original.durationMs / 1000).toFixed(2)}s` 
          : '—',
    },
    {
      accessorKey: 'triggerType',
      header: t('scheduler.execution.trigger', 'Trigger'),
      cell: ({ row }) => t(`scheduler.trigger_type.${row.original.triggerType}`, row.original.triggerType),
    },
    {
      id: 'actions',
      header: t('scheduler.execution.actions', 'Actions'),
      cell: ({ row }) => {
        const canViewLogs = isAsyncStrategy && 
          row.original.queueJobId && 
          row.original.queueName
        const hasDetails = row.original.errorMessage || row.original.finishedAt

        return (
          <div className="flex items-center gap-2">
            {hasDetails && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleViewDetails(row.original)}
              >
                {t('scheduler.execution.view_details', 'View Details')}
              </Button>
            )}
            {canViewLogs && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleViewLogs(row.original)}
              >
                {t('scheduler.execution.view_logs', 'View Logs')}
              </Button>
            )}
            {!hasDetails && !canViewLogs && (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        )
      },
    },
  ]

  if (loading) return <LoadingMessage label={t('scheduler.loading', 'Loading schedule...')} />
  if (error) return <ErrorMessage label={t('scheduler.details.error', 'Error')} description={error} />
  if (!schedule) return <ErrorMessage label={t('scheduler.details.not_found', 'Not Found')} description={t('scheduler.error.not_found', 'Schedule not found')} />

  return (
    <Page>
      {ConfirmDialogElement}
      <PageHeader
        title={schedule.name}
        description={schedule.description}
        actions={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-enabled" className="text-sm font-medium cursor-pointer">
                {schedule.isEnabled ? t('scheduler.status.enabled', 'Enabled') : t('scheduler.status.disabled', 'Disabled')}
              </Label>
              <Switch
                id="schedule-enabled"
                checked={schedule.isEnabled}
                onCheckedChange={handleToggleEnabled}
                disabled={toggling}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleTriggerNow}
              disabled={triggering || !schedule.isEnabled}
            >
              {triggering ? t('scheduler.details.triggering', 'Triggering...') : t('scheduler.action.trigger', 'Trigger Now')}
            </Button>
            <Button onClick={() => router.push(`/backend/config/scheduled-jobs/${scheduleId}/edit`)}>
              {t('scheduler.action.edit', 'Edit')}
            </Button>
          </div>
        }
      />

      <PageBody>
        <div className="space-y-6">
          {/* Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle>{t('scheduler.details.configuration', 'Configuration')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.field.status', 'Status')}</dt>
                  <dd className="mt-1">
                    <Badge variant={schedule.isEnabled ? 'default' : 'secondary'}>
                      {schedule.isEnabled ? t('scheduler.status.enabled', 'Enabled') : t('scheduler.status.disabled', 'Disabled')}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.field.schedule', 'Schedule')}</dt>
                  <dd className="text-sm mt-1">
                    {schedule.scheduleValue} 
                    <span className="text-muted-foreground ml-1">({schedule.scheduleType})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.field.timezone', 'Timezone')}</dt>
                  <dd className="text-sm mt-1">{schedule.timezone}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.field.target', 'Target')}</dt>
                  <dd className="text-sm mt-1">
                    <Badge variant="outline">
                      {schedule.targetType === 'queue' ? schedule.targetQueue : schedule.targetCommand}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.details.scope', 'Scope')}</dt>
                  <dd className="text-sm mt-1">{schedule.scopeType}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.field.source', 'Source')}</dt>
                  <dd className="text-sm mt-1">
                    {schedule.sourceType === 'module' && schedule.sourceModule 
                      ? `${schedule.sourceModule} (${t('scheduler.details.source_module', 'module')})` 
                      : t('scheduler.details.source_user', 'User-created')}
                  </dd>
                </div>
                {schedule.nextRunAt && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.field.next_run', 'Next Run')}</dt>
                    <dd className="text-sm mt-1">
                      {new Date(schedule.nextRunAt).toLocaleString()}
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(schedule.nextRunAt), { addSuffix: true })}
                      </div>
                    </dd>
                  </div>
                )}
                {schedule.lastRunAt && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.details.last_run', 'Last Run')}</dt>
                    <dd className="text-sm mt-1">
                      {new Date(schedule.lastRunAt).toLocaleString()}
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(schedule.lastRunAt), { addSuffix: true })}
                      </div>
                    </dd>
                  </div>
                )}
                {schedule.requireFeature && (
                  <div className="col-span-2">
                    <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.details.required_feature', 'Required Feature')}</dt>
                    <dd className="text-sm mt-1">
                      <Badge variant="outline">{schedule.requireFeature}</Badge>
                    </dd>
                  </div>
                )}
                {schedule.targetPayload && Object.keys(schedule.targetPayload).length > 0 && (
                  <div className="col-span-2">
                    <dt className="text-sm font-medium text-muted-foreground">{t('scheduler.details.payload', 'Payload')}</dt>
                    <dd className="mt-1">
                      <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-32">
                        {JSON.stringify(schedule.targetPayload, null, 2)}
                      </pre>
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Recent Executions Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t('scheduler.details.recent_executions', 'Recent Executions')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {runs.length > 0 ? (
                <DataTable
                  columns={runsColumns}
                  data={runs}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('scheduler.details.no_executions', 'No executions yet')}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>

      <ExecutionDetailsDialog
        open={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        run={selectedRun}
        scheduleName={schedule.name}
      />

      <JobLogsModal
        open={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
        queueJobId={selectedRun?.queueJobId || null}
        queueName={selectedRun?.queueName || null}
        scheduleName={schedule.name}
      />
    </Page>
  )
}
