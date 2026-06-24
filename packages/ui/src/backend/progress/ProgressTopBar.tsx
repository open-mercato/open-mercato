"use client"
import * as React from 'react'
import { ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Progress } from '../../primitives/progress'
import { cn } from '@open-mercato/shared/lib/utils'
import { useProgress } from './useProgress'
import { useAutoHideCompletedJobs } from './useAutoHideCompletedJobs'
import type { ProgressJobDto } from './useProgressPoll'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '../utils/apiCall'

export type ProgressTopBarProps = {
  className?: string
  t: TranslateFn
  /**
   * How long (ms) to keep successfully completed jobs visible before auto-hiding.
   * Set to `false` or `0` to disable auto-hide. Defaults to 10 000 ms.
   * Failed and cancelled jobs are never auto-hidden.
   */
  completedAutoHideMs?: number | false
}

export function ProgressTopBar({ className, t, completedAutoHideMs }: ProgressTopBarProps) {
  const { activeJobs, recentlyCompleted, refresh } = useProgress()
  const visibleCompleted = useAutoHideCompletedJobs(recentlyCompleted, completedAutoHideMs)
  const [expanded, setExpanded] = React.useState(false)

  // `om:progress:expanded` is a trivial scalar flag ('true' | 'false') with no
  // schema to evolve, so it is intentionally kept raw rather than wrapped in a
  // versioned envelope (the versioning threshold for structured persisted state
  // lives in `@open-mercato/shared/lib/browser/versionedPreference`).
  React.useEffect(() => {
    const saved = localStorage.getItem('om:progress:expanded')
    if (saved === 'true') setExpanded(true)
  }, [])

  React.useEffect(() => {
    localStorage.setItem('om:progress:expanded', String(expanded))
  }, [expanded])

  const hasActiveJobs = activeJobs.length > 0
  const hasRecentJobs = visibleCompleted.length > 0

  if (!hasActiveJobs && !hasRecentJobs) return null

  return (
    <div className={cn('border-b bg-background', className)}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="h-auto w-full justify-between rounded-none bg-background px-4 py-2 hover:bg-muted"
      >
        <div className="flex items-center gap-2 text-sm">
          {hasActiveJobs ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>
                {t('progress.activeCount', '{count} operations running', { count: activeJobs.length })}
              </span>
              {activeJobs[0] && (
                <span className="text-muted-foreground">
                  — {activeJobs[0].name}{' '}
                  {activeJobs[0].totalCount && activeJobs[0].totalCount > 0
                    ? `(${activeJobs[0].progressPercent}%)`
                    : `(${activeJobs[0].processedCount.toLocaleString()} ${t('progress.processed', 'processed')})`}
                </span>
              )}
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 text-status-success-icon" />
              <span className="text-muted-foreground">
                {t('progress.recentlyCompleted', '{count} operations completed', { count: visibleCompleted.length })}
              </span>
            </>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {expanded && (
        <div className="space-y-2 bg-background px-4 pb-3">
          {activeJobs.map((job) => (
            <ProgressJobCard key={job.id} job={job} t={t} onCancel={refresh} />
          ))}
          {visibleCompleted.map((job) => (
            <ProgressJobCard key={job.id} job={job} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProgressJobCard({ job, t, onCancel }: { job: ProgressJobDto; t: TranslateFn; onCancel?: () => void }) {
  const [cancelling, setCancelling] = React.useState(false)

  const handleCancel = async () => {
    if (!job.cancellable || cancelling) return
    setCancelling(true)
    try {
      await apiCall(`/api/progress/jobs/${job.id}`, { method: 'DELETE' })
      onCancel?.()
    } finally {
      setCancelling(false)
    }
  }

  const isActive = job.status === 'pending' || job.status === 'running'
  const isFailed = job.status === 'failed'
  const isCompleted = job.status === 'completed'

  return (
    <div className={cn(
      'rounded-md border bg-card p-3',
      isFailed && 'border-destructive/50 bg-destructive/5',
      isCompleted && 'border-status-success-border bg-status-success-bg',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />}
            {isCompleted && <CheckCircle className="h-4 w-4 text-status-success-icon flex-shrink-0" />}
            {isFailed && <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />}
            <span className="font-medium truncate">{job.name}</span>
          </div>

          {job.description && (
            <p className="text-sm text-muted-foreground mt-1 truncate">{job.description}</p>
          )}

          {isFailed && job.errorMessage && (
            <p className="text-sm text-destructive mt-1">{job.errorMessage}</p>
          )}
        </div>

        {isActive && job.cancellable && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={cancelling}
            className="flex-shrink-0"
            aria-label={t('progress.actions.cancel', 'Cancel')}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isActive && (
        <div className="mt-2 space-y-1">
          {job.totalCount && job.totalCount > 0 ? (
            <Progress value={job.progressPercent} className="h-2" />
          ) : (
            <IndeterminateProgressBar className="h-2" />
          )}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {job.totalCount
                ? `${job.processedCount.toLocaleString()} / ${job.totalCount.toLocaleString()}`
                : `${job.processedCount.toLocaleString()} ${t('progress.processed', 'processed')}`
              }
            </span>
            {job.etaSeconds != null && job.etaSeconds > 0 && (
              <span>{formatEta(job.etaSeconds, t)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function IndeterminateProgressBar({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div className="absolute inset-y-0 left-0 w-1/2 animate-pulse rounded-full bg-primary/80" />
      <div className="absolute inset-y-0 right-0 w-1/3 rounded-full bg-primary/10" />
    </div>
  )
}

function formatEta(seconds: number, t: TranslateFn): string {
  if (seconds < 60) {
    return t('progress.eta.seconds', '{count}s remaining', { count: seconds })
  }
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60)
    return t('progress.eta.minutes', '{count}m remaining', { count: minutes })
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.ceil((seconds % 3600) / 60)
  return t('progress.eta.hoursMinutes', '{hours}h {minutes}m remaining', { hours, minutes: mins })
}
