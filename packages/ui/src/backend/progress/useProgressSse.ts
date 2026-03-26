"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import { useAppEvent } from '../injection/useAppEvent'
import type { ProgressJobDto, UseProgressPollResult } from './useProgressPoll'

function isVisibleProgressJob(job: ProgressJobDto): boolean {
  return job.meta?.hiddenFromTopBar !== true
}

function upsertJob(list: ProgressJobDto[], job: ProgressJobDto): ProgressJobDto[] {
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

export function useProgressSse(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJobDto[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJobDto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchJobs = React.useCallback(async () => {
    try {
      const result = await apiCall<{ active: ProgressJobDto[]; recentlyCompleted: ProgressJobDto[] }>(
        '/api/progress/active',
      )
      if (result.ok && result.result) {
        setActiveJobs(result.result.active.filter(isVisibleProgressJob))
        setRecentlyCompleted(result.result.recentlyCompleted.filter(isVisibleProgressJob))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = React.useCallback(() => {
    void fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent(
    'progress.job.updated',
    (event) => {
      const payload = event.payload as Partial<ProgressJobDto> & { jobId?: string }
      const jobId = payload?.jobId
      if (!jobId) {
        void fetchJobs()
        return
      }
      setActiveJobs((prev) =>
        upsertJob(prev, {
          id: jobId,
          jobType: payload.jobType ?? 'progress',
          name: payload.name ?? payload.jobType ?? 'Progress job',
          description: payload.description ?? null,
          meta: (payload.meta && typeof payload.meta === 'object') ? payload.meta as Record<string, unknown> : null,
          status: (payload.status as ProgressJobDto['status']) ?? 'running',
          progressPercent: payload.progressPercent ?? 0,
          processedCount: payload.processedCount ?? 0,
          totalCount: payload.totalCount ?? null,
          etaSeconds: payload.etaSeconds ?? null,
          cancellable: payload.cancellable ?? false,
          startedAt: payload.startedAt ?? null,
          finishedAt: payload.finishedAt ?? null,
          errorMessage: payload.errorMessage ?? null,
        }),
      )
    },
    [fetchJobs],
  )

  useAppEvent('progress.job.created', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.started', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.completed', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.failed', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.cancelled', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('om:bridge:reconnected', () => {
    void fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    const onFocus = () => {
      void fetchJobs()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchJobs])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh }
}
