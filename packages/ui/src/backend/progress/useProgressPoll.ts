"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeProgressUpdate,
  subscribeProgressComplete,
} from '@open-mercato/shared/lib/frontend/progressEvents'

export type ProgressJobDto = {
  id: string
  jobType: string
  name: string
  description?: string | null
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
        setActiveJobs(result.result.active)
        setRecentlyCompleted(result.result.recentlyCompleted)
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
    const interval = setInterval(fetchJobs, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchJobs])

  React.useEffect(() => {
    const unsubUpdate = subscribeProgressUpdate(() => refresh())
    const unsubComplete = subscribeProgressComplete(() => refresh())
    return () => {
      unsubUpdate()
      unsubComplete()
    }
  }, [refresh])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh }
}
