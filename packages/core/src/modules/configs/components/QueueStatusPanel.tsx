"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type {
  QueueStatusSnapshot,
  QueueStatusEntryDto,
  FailedJobSummaryDto,
  InFlightJobSummaryDto,
} from '../lib/queue-status.types'
import { QueueJobInspector } from './QueueJobInspector'

const API_PATH = '/api/configs/queues-status'

/**
 * Client-side ceiling for one snapshot request. The server bounds each queue read itself, so this
 * only matters when the server cannot answer at all — the panel must end in an error, not a spinner.
 */
const REQUEST_TIMEOUT_MS = 30_000

const FIDELITY_BADGE_VARIANTS: StatusMap<'exact' | 'partial'> = {
  exact: 'success',
  partial: 'warning',
}

type TranslateFn = ReturnType<typeof useT>

function isQueueStatusSnapshot(payload: unknown): payload is QueueStatusSnapshot {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as { queues?: unknown; generatedAt?: unknown }
  return Array.isArray(value.queues) && typeof value.generatedAt === 'string'
}

function formatDurationMs(ms: number | undefined, t: TranslateFn): string {
  if (ms === undefined) return t('configs.queuesStatus.value.notAvailable', 'n/a')
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function formatTimestamp(ms: number | undefined): string {
  if (ms === undefined) return '—'
  return new Date(ms).toLocaleString()
}

/** Enter / Space activate a `role="button"` row exactly like a click (Space must not scroll the page). */
function activateOnKey(event: React.KeyboardEvent, activate: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  activate()
}

type FetchState = {
  loading: boolean
  error: string | null
  snapshot: QueueStatusSnapshot | null
}

type InspectorTarget = { queue: string; jobId: string } | null

function FailedJobsTable({
  jobs,
  t,
  onInspect,
}: {
  jobs: FailedJobSummaryDto[]
  t: TranslateFn
  onInspect?: (jobId: string) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-1 pr-3">{t('configs.queuesStatus.failed.columns.id', 'Job id')}</th>
          <th className="py-1 pr-3">{t('configs.queuesStatus.failed.columns.type', 'Type')}</th>
          <th className="py-1 pr-3">{t('configs.queuesStatus.failed.columns.worker', 'Worker')}</th>
          <th className="py-1 pr-3">{t('configs.queuesStatus.failed.columns.reason', 'Reason')}</th>
          <th className="py-1 pr-3">{t('configs.queuesStatus.failed.columns.attempts', 'Attempts')}</th>
          <th className="py-1 pr-3">{t('configs.queuesStatus.failed.columns.failedAt', 'Failed at')}</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const reason = job.errorCode
            ? t(`configs.queuesStatus.failed.codes.${job.errorCode}`, job.errorCode)
            : '—'
          const cells = (
            <>
              <td className="py-1 pr-3 font-mono text-xs">{job.id}</td>
              <td className="py-1 pr-3">{job.type ?? '—'}</td>
              <td className="py-1 pr-3">{job.workerId ?? '—'}</td>
              <td className="py-1 pr-3 max-w-xs truncate" title={reason}>{reason}</td>
              <td className="py-1 pr-3">{job.attemptsMade ?? '—'}</td>
              <td className="py-1 pr-3">{formatTimestamp(job.failedAt)}</td>
            </>
          )
          if (!onInspect) return <tr key={job.id} className="border-b last:border-0">{cells}</tr>
          return (
            <tr
              key={job.id}
              data-job-id={job.id}
              className="border-b last:border-0 cursor-pointer hover:bg-muted"
              role="button"
              tabIndex={0}
              onClick={() => onInspect(job.id)}
              onKeyDown={(event) => activateOnKey(event, () => onInspect(job.id))}
            >
              {cells}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function InFlightTable({
  rows,
  columnLabelKey,
  columnLabelFallback,
  durationLabelKey,
  durationLabelFallback,
  durationKey,
  t,
  canInspect,
  onInspect,
}: {
  rows: InFlightJobSummaryDto[]
  columnLabelKey: string
  columnLabelFallback: string
  durationLabelKey: string
  durationLabelFallback: string
  durationKey: 'runningMs' | 'ageMs'
  t: TranslateFn
  canInspect: boolean
  onInspect?: (queue: string, jobId: string) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-1 pr-3">{t(columnLabelKey, columnLabelFallback)}</th>
          <th className="py-1 pr-3">{t('configs.queuesStatus.inFlight.columns.type', 'Type')}</th>
          <th className="py-1 pr-3">{t(durationLabelKey, durationLabelFallback)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const duration = row[durationKey]
          const slow = typeof duration === 'number' && duration > 60_000
          const content = (
            <>
              <td className="py-1 pr-3 font-mono text-xs">{row.id}</td>
              <td className="py-1 pr-3">{row.type ?? '—'}</td>
              <td className={cn('py-1 pr-3', slow && 'text-status-warning-foreground')}>
                {formatDurationMs(duration, t)}
              </td>
            </>
          )
          if (canInspect && onInspect) {
            return (
              <tr
                key={row.id}
                className="border-b last:border-0 cursor-pointer hover:bg-muted"
                onClick={() => onInspect(row.queue, row.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => activateOnKey(event, () => onInspect(row.queue, row.id))}
              >
                {content}
              </tr>
            )
          }
          return <tr key={row.id} className="border-b last:border-0">{content}</tr>
        })}
      </tbody>
    </table>
  )
}

function QueueCard({
  entry,
  t,
  canInspectPayloads,
  onInspect,
}: {
  entry: QueueStatusEntryDto
  t: TranslateFn
  canInspectPayloads: boolean
  onInspect: (queue: string, jobId: string) => void
}) {
  return (
    <article className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{entry.queue}</h3>
          <p className="text-xs text-muted-foreground">
            {t('configs.queuesStatus.strategy', 'Strategy: {{strategy}}', { strategy: entry.strategy })}
            {entry.workerIds.length > 0
              ? ` · ${t('configs.queuesStatus.workers', 'Workers: {{ids}}', { ids: entry.workerIds.join(', ') })}`
              : ''}
          </p>
        </div>
        <StatusBadge variant={FIDELITY_BADGE_VARIANTS[entry.fidelity]}>
          {entry.fidelity === 'partial'
            ? t('configs.queuesStatus.fidelity.partial', 'Partial (approximate)')
            : t('configs.queuesStatus.fidelity.exact', 'Exact')}
        </StatusBadge>
      </div>

      {entry.error ? (
        <ErrorMessage
          label={t(
            `configs.queuesStatus.entryError.${entry.error}`,
            t('configs.queuesStatus.entryError.queue_read_failed', 'Queue status could not be read.'),
          )}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {([
              ['waiting', entry.counts.waiting, 'neutral'],
              ['active', entry.counts.active, 'info'],
              ['completed', entry.counts.completed, 'success'],
              ['failed', entry.counts.failed, 'error'],
              ...(entry.counts.delayed !== undefined ? [['delayed', entry.counts.delayed, 'neutral']] as const : []),
            ] as const).map(([key, value, variant]) => (
              <div key={key} className="flex flex-col items-start gap-1 rounded border bg-background p-2">
                <StatusBadge variant={variant}>{t(`configs.queuesStatus.counts.${key}`, key)}</StatusBadge>
                <span className="text-lg font-semibold">{value}</span>
              </div>
            ))}
          </div>

          {entry.processingStats ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.processing.last', 'Last')}
                </dt>
                <dd>{formatDurationMs(entry.processingStats.lastProcessingMs, t)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.processing.avg', 'Average')}
                </dt>
                <dd>{formatDurationMs(entry.processingStats.avgProcessingMs, t)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.processing.p95', 'p95')}
                </dt>
                <dd>{formatDurationMs(entry.processingStats.p95ProcessingMs, t)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.processing.avgWait', 'Avg wait')}
                </dt>
                <dd>{formatDurationMs(entry.processingStats.avgWaitMs, t)}</dd>
              </div>
              <p className="col-span-full text-xs text-muted-foreground">
                {t('configs.queuesStatus.processing.sampleSize', 'Based on {{count}} recently completed jobs', { count: entry.processingStats.sampleSize })}
              </p>
            </div>
          ) : null}

          {entry.inFlightUnavailable ? (
            <p className="text-xs text-muted-foreground">
              {t('configs.queuesStatus.inFlight.unavailable', 'In-flight and queued job details are unavailable for this queue.')}
            </p>
          ) : null}

          {entry.inFlight && entry.inFlight.length > 0 ? (
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">{t('configs.queuesStatus.inFlight.title', 'In flight')}</h4>
              <InFlightTable
                rows={entry.inFlight}
                columnLabelKey="configs.queuesStatus.inFlight.columns.id"
                columnLabelFallback="Job id"
                durationLabelKey="configs.queuesStatus.inFlight.columns.running"
                durationLabelFallback="Running for"
                durationKey="runningMs"
                t={t}
                canInspect={canInspectPayloads}
                onInspect={onInspect}
              />
            </div>
          ) : null}

          {entry.agedWaiting && entry.agedWaiting.length > 0 ? (
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">{t('configs.queuesStatus.agedWaiting.title', 'Oldest queued')}</h4>
              <InFlightTable
                rows={entry.agedWaiting}
                columnLabelKey="configs.queuesStatus.inFlight.columns.id"
                columnLabelFallback="Job id"
                durationLabelKey="configs.queuesStatus.agedWaiting.columns.age"
                durationLabelFallback="Queued for"
                durationKey="ageMs"
                t={t}
                canInspect={canInspectPayloads}
                onInspect={onInspect}
              />
            </div>
          ) : null}

          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{t('configs.queuesStatus.failed.title', 'Recent failures')}</h4>
            {entry.failedJobsUnavailable ? (
              <p className="text-xs text-muted-foreground">
                {t('configs.queuesStatus.failed.unavailable', 'Failed-job details are unavailable for this strategy.')}
              </p>
            ) : entry.failedJobs && entry.failedJobs.length > 0 ? (
              <FailedJobsTable
                jobs={entry.failedJobs}
                t={t}
                onInspect={canInspectPayloads ? (jobId) => onInspect(entry.queue, jobId) : undefined}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('configs.queuesStatus.failed.none', 'No recent failures.')}
              </p>
            )}
          </div>
        </>
      )}
    </article>
  )
}

export function QueueStatusPanel() {
  const t = useT()
  const [state, setState] = React.useState<FetchState>({ loading: true, error: null, snapshot: null })
  const [queueFilter, setQueueFilter] = React.useState<string>('')
  const [typeFilter, setTypeFilter] = React.useState<string>('')
  const [appliedFilters, setAppliedFilters] = React.useState<{ queue: string; type: string }>({ queue: '', type: '' })
  const [inspectorTarget, setInspectorTarget] = React.useState<InspectorTarget>(null)

  const loadSnapshot = React.useCallback(async (filters: { queue: string; type: string }) => {
    setState((current) => ({ ...current, loading: true, error: null }))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const params = new URLSearchParams()
      if (filters.queue) params.set('queue', filters.queue)
      if (filters.type) params.set('type', filters.type)
      const query = params.toString()
      const payload = await readApiResultOrThrow<unknown>(query ? `${API_PATH}?${query}` : API_PATH, { signal: controller.signal }, {
        errorMessage: t('configs.queuesStatus.error', 'Failed to load queue status'),
      })
      if (!isQueueStatusSnapshot(payload)) {
        setState({
          loading: false,
          error: t('configs.queuesStatus.invalidResponse', 'Unexpected response when loading queue status'),
          snapshot: null,
        })
        return
      }
      setState({ loading: false, error: null, snapshot: payload })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.queuesStatus.error', 'Failed to load queue status')
      setState({ loading: false, error: message, snapshot: null })
    } finally {
      clearTimeout(timeout)
    }
  }, [t])

  React.useEffect(() => {
    loadSnapshot(appliedFilters).catch(() => {})
  }, [loadSnapshot, appliedFilters])

  const handleApplyFilters = React.useCallback((event: React.FormEvent) => {
    event.preventDefault()
    setAppliedFilters({ queue: queueFilter, type: typeFilter.trim() })
  }, [queueFilter, typeFilter])

  const inspectorOpenerRef = React.useRef<HTMLElement | null>(null)

  const handleInspect = React.useCallback((queue: string, jobId: string) => {
    // Remember the row that opened the inspector so focus can go back to it on close.
    inspectorOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setInspectorTarget({ queue, jobId })
  }, [])

  const handleInspectorClosed = React.useCallback(() => {
    setInspectorTarget(null)
  }, [])

  if (state.loading && !state.snapshot) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.queuesStatus.title', 'Queue status')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.queuesStatus.description', 'Job counts and failed-job visibility for every registered background queue.')}
          </p>
        </header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('configs.queuesStatus.loading', 'Loading queue status…')}
        </div>
      </section>
    )
  }

  if (state.error) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.queuesStatus.title', 'Queue status')}</h2>
        </header>
        <ErrorMessage label={state.error} />
        <Button type="button" variant="outline" onClick={() => loadSnapshot(appliedFilters).catch(() => {})}>
          {t('configs.queuesStatus.retry', 'Retry')}
        </Button>
      </section>
    )
  }

  const snapshot = state.snapshot
  if (!snapshot) return null

  const queueOptions = Array.from(new Set(snapshot.queues.map((q) => q.queue))).sort()

  return (
    <section className="space-y-6 rounded-lg border bg-background p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('configs.queuesStatus.title', 'Queue status')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('configs.queuesStatus.description', 'Job counts and failed-job visibility for every registered background queue.')}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('configs.queuesStatus.generatedAt', 'Snapshot generated {{timestamp}}', { timestamp: new Date(snapshot.generatedAt).toLocaleString() })}
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleApplyFilters}>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="queue-status-queue-filter">
            {t('configs.queuesStatus.filter.queue', 'Queue')}
          </label>
          <Select value={queueFilter || '__all__'} onValueChange={(value) => setQueueFilter(value === '__all__' ? '' : value)}>
            <SelectTrigger id="queue-status-queue-filter" className="w-48">
              <SelectValue placeholder={t('configs.queuesStatus.filter.allQueues', 'All queues')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('configs.queuesStatus.filter.allQueues', 'All queues')}</SelectItem>
              {queueOptions.map((queue) => (
                <SelectItem key={queue} value={queue}>{queue}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="queue-status-type-filter">
            {t('configs.queuesStatus.filter.type', 'Job type')}
          </label>
          <Input
            id="queue-status-type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            placeholder={t('configs.queuesStatus.filter.typePlaceholder', 'Any')}
            className="w-48"
          />
        </div>
        <Button type="submit" variant="outline">{t('configs.queuesStatus.filter.apply', 'Apply')}</Button>
        <Button type="button" variant="ghost" onClick={() => loadSnapshot(appliedFilters).catch(() => {})}>
          {t('configs.queuesStatus.refresh', 'Refresh')}
        </Button>
      </form>

      {snapshot.queues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('configs.queuesStatus.empty', 'No registered queues matched this filter.')}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.queues.map((entry) => (
            <QueueCard
              key={entry.queue}
              entry={entry}
              t={t}
              canInspectPayloads={snapshot.canInspectPayloads}
              onInspect={handleInspect}
            />
          ))}
        </div>
      )}

      {snapshot.canInspectPayloads && inspectorTarget ? (
        <QueueJobInspector
          queue={inspectorTarget.queue}
          jobId={inspectorTarget.jobId}
          onClose={handleInspectorClosed}
          returnFocusRef={inspectorOpenerRef}
        />
      ) : null}
    </section>
  )
}

export default QueueStatusPanel
