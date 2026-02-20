import type { ProgressJob } from '../data/entities'
import type { CreateProgressJobInput, UpdateProgressInput, CompleteJobInput, FailJobInput } from '../data/validators'

export interface ProgressServiceContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface ProgressService {
  createJob(input: CreateProgressJobInput, ctx: ProgressServiceContext): Promise<ProgressJob>
  startJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob>
  updateProgress(jobId: string, input: UpdateProgressInput, ctx: ProgressServiceContext): Promise<ProgressJob>
  incrementProgress(jobId: string, delta: number, ctx: ProgressServiceContext): Promise<ProgressJob>
  completeJob(jobId: string, input?: CompleteJobInput, ctx?: ProgressServiceContext): Promise<ProgressJob>
  failJob(jobId: string, input: FailJobInput, ctx?: ProgressServiceContext): Promise<ProgressJob>
  cancelJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob>
  isCancellationRequested(jobId: string): Promise<boolean>
  getActiveJobs(ctx: ProgressServiceContext): Promise<ProgressJob[]>
  getJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob | null>
  markStaleJobsFailed(timeoutSeconds: number): Promise<number>
}

export const HEARTBEAT_INTERVAL_MS = 5000
export const STALE_JOB_TIMEOUT_SECONDS = 60

export function calculateEta(
  processedCount: number,
  totalCount: number,
  startedAt: Date,
): number | null {
  if (processedCount === 0 || totalCount === 0) return null

  const elapsedMs = Date.now() - startedAt.getTime()
  const rate = processedCount / elapsedMs
  const remaining = totalCount - processedCount

  if (rate <= 0) return null

  return Math.ceil(remaining / rate / 1000)
}

export function calculateProgressPercent(processedCount: number, totalCount: number | null): number {
  if (!totalCount || totalCount <= 0) return 0
  return Math.min(100, Math.round((processedCount / totalCount) * 100))
}
