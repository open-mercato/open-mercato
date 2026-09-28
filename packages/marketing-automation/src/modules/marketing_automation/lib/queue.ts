import { createModuleQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'
import {
  MARKETING_DISPATCH_QUEUE,
  MARKETING_RESUME_QUEUE,
  MARKETING_SWEEP_QUEUE,
} from './queues.js'

export type DispatchJob = {
  eventId: string
  scope: { tenantId: string; organizationId: string }
  payload: Record<string, unknown>
  dispatchDepth?: number
}

export type ResumeJob =
  | { runId: string; scope: { tenantId: string; organizationId: string } }
  | { scope: { tenantId: string; organizationId: string } }

export type SweepJob = {
  scope: { tenantId: string; organizationId: string }
}

// Queues are created lazily and cached: constructing one opens a Redis connection under the
// async strategy, and a module-load-time connection would be opened by every process that
// merely imports this file, including the CLI.
let dispatchQueue: Queue<DispatchJob> | null = null
let resumeQueue: Queue<ResumeJob> | null = null
let sweepQueue: Queue<SweepJob> | null = null

export function getDispatchQueue(): Queue<DispatchJob> {
  dispatchQueue ??= createModuleQueue<DispatchJob>(MARKETING_DISPATCH_QUEUE, { concurrency: 8 })
  return dispatchQueue
}

export function getResumeQueue(): Queue<ResumeJob> {
  resumeQueue ??= createModuleQueue<ResumeJob>(MARKETING_RESUME_QUEUE, { concurrency: 5 })
  return resumeQueue
}

export function getSweepQueue(): Queue<SweepJob> {
  sweepQueue ??= createModuleQueue<SweepJob>(MARKETING_SWEEP_QUEUE, { concurrency: 1 })
  return sweepQueue
}

export async function enqueueDispatch(job: DispatchJob): Promise<void> {
  await getDispatchQueue().enqueue(job)
}

export async function enqueueResume(
  runId: string,
  scope: { tenantId: string; organizationId: string },
  delayMs: number,
): Promise<void> {
  await getResumeQueue().enqueue({ runId, scope }, { delayMs })
}
