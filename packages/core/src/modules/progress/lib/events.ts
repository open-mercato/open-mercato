export const PROGRESS_EVENTS = {
  JOB_CREATED: 'progress.job.created',
  JOB_STARTED: 'progress.job.started',
  JOB_UPDATED: 'progress.job.updated',
  JOB_COMPLETED: 'progress.job.completed',
  JOB_FAILED: 'progress.job.failed',
  JOB_CANCELLED: 'progress.job.cancelled',
} as const

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
