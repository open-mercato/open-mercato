"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeProgressUpdate,
  subscribeProgressComplete,
  type ProgressUpdateDetail,
} from '@open-mercato/shared/lib/frontend/progressEvents'

export type ProgressJobDto = {
  id: string
  jobType: string
  name: string
  description?: string | null
  meta?: Record<string, unknown> | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  cancellable: boolean
  startedAt?: string | null
  finishedAt?: string | null
  errorMessage?: string | null
}

export type UseProgressPollResult = {
  activeJobs: ProgressJobDto[]
  recentlyCompleted: ProgressJobDto[]
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const POLL_INTERVAL = 5000

function isVisibleProgressJob(job: ProgressJobDto): boolean {
  return job.meta?.hiddenFromTopBar !== true
}

export function isLocalProgressJob(job: ProgressJobDto): boolean {
  return job.id.startsWith('client:')
}

function isTerminalStatus(status: ProgressJobDto['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function localJobFromProgressDetail(detail: ProgressUpdateDetail): ProgressJobDto {
  const now = new Date().toISOString()
  const status = detail.status
  return {
    id: detail.jobId,
    jobType: detail.jobType,
    name: detail.name,
    description: detail.description ?? null,
    meta: detail.meta ?? null,
    status,
    progressPercent: detail.progressPercent,
    processedCount: detail.processedCount,
    totalCount: detail.totalCount ?? null,
    etaSeconds: detail.etaSeconds ?? null,
    cancellable: detail.cancellable ?? false,
    startedAt: detail.startedAt ?? now,
    finishedAt: detail.finishedAt ?? (isTerminalStatus(status) ? now : null),
    errorMessage: detail.errorMessage ?? null,
  }
}

function upsertLocalJob(list: ProgressJobDto[], job: ProgressJobDto): ProgressJobDto[] {
  if (!isVisibleProgressJob(job)) {
    return list.filter((item) => item.id !== job.id)
  }
  const next = [job, ...list.filter((item) => item.id !== job.id)]
  return next.sort(
    (a, b) =>
      new Date(b.startedAt ?? b.finishedAt ?? 0).getTime()
      - new Date(a.startedAt ?? a.finishedAt ?? 0).getTime(),
  )
}

export function applyLocalProgressUpdate(
  detail: ProgressUpdateDetail,
  setActiveJobs: React.Dispatch<React.SetStateAction<ProgressJobDto[]>>,
  setRecentlyCompleted: React.Dispatch<React.SetStateAction<ProgressJobDto[]>>,
): void {
  const job = localJobFromProgressDetail(detail)
  if (isTerminalStatus(job.status)) {
    setActiveJobs((prev) => prev.filter((item) => item.id !== job.id))
    setRecentlyCompleted((prev) => upsertLocalJob(prev, job).slice(0, 10))
    return
  }
  setRecentlyCompleted((prev) => prev.filter((item) => item.id !== job.id))
  setActiveJobs((prev) => upsertLocalJob(prev, job).slice(0, 50))
}

export function useProgressPoll(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJobDto[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJobDto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchJobs = React.useCallback(async () => {
    try {
      const result = await apiCall<{ active: ProgressJobDto[]; recentlyCompleted: ProgressJobDto[] }>(
        '/api/progress/active'
      )
      if (result.ok && result.result) {
        setActiveJobs((prev) => [
          ...prev.filter((job) => isLocalProgressJob(job) && !isTerminalStatus(job.status)),
          ...result.result!.active.filter(isVisibleProgressJob),
        ])
        setRecentlyCompleted((prev) => [
          ...prev.filter((job) => isLocalProgressJob(job) && isTerminalStatus(job.status)),
          ...result.result!.recentlyCompleted.filter(isVisibleProgressJob),
        ].slice(0, 10))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = React.useCallback(() => {
    fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    fetchJobs()
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchJobs, POLL_INTERVAL)

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (interval) {
          clearInterval(interval)
          interval = null
        }
      } else {
        fetchJobs()
        interval = setInterval(fetchJobs, POLL_INTERVAL)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchJobs])

  React.useEffect(() => {
    const unsubUpdate = subscribeProgressUpdate((detail) => {
      applyLocalProgressUpdate(detail, setActiveJobs, setRecentlyCompleted)
    })
    const unsubComplete = subscribeProgressComplete(() => refresh())
    return () => {
      unsubUpdate()
      unsubComplete()
    }
  }, [refresh])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh }
}
