import { events } from '../events'

type EventEntry = typeof events[number]
type EventMap = { [K in EventEntry['id'] as Uppercase<K extends `progress.job.${infer A}` ? `JOB_${A}` : never>]: K }

function buildEventMap<T extends readonly { id: string }[]>(defs: T) {
  const map: Record<string, string> = {}
  for (const def of defs) {
    const suffix = def.id.replace('progress.job.', '')
    map[`JOB_${suffix.toUpperCase()}`] = def.id
  }
  return map as EventMap
}

export const PROGRESS_EVENTS = buildEventMap(events)

export type ProgressJobCreatedPayload = {
  jobId: string
  jobType: string
  name: string
  tenantId: string
  organizationId?: string | null
}

export type ProgressJobStartedPayload = {
  jobId: string
  jobType: string
  tenantId: string
}

export type ProgressJobUpdatedPayload = {
  jobId: string
  jobType?: string
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  tenantId: string
}

export type ProgressJobCompletedPayload = {
  jobId: string
  jobType: string
  resultSummary?: Record<string, unknown> | null
  tenantId: string
}

export type ProgressJobFailedPayload = {
  jobId: string
  jobType: string
  errorMessage: string
  tenantId: string
  stale?: boolean
}

export type ProgressJobCancelledPayload = {
  jobId: string
  jobType: string
  tenantId: string
}
