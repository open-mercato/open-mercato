import { createModuleQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'
import {
  MARKETING_DISPATCH_QUEUE,
  MARKETING_RESUME_QUEUE,
  MARKETING_SEGMENT_ACTION_QUEUE,
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

/**
 * A bulk action over a segment's members.
 *
 * Carries the SEGMENT rather than a list of ids: membership is resolved when the job runs, so an action
 * queued at 9am acts on who is in the segment at 9.05 rather than on a list that was already stale when it
 * was written. The progress job id travels with it so the top bar can follow the work.
 */
export type SegmentActionJob = {
  scope: { tenantId: string; organizationId: string }
  segmentId: string
  progressJobId: string
  actorId: string | null
  action:
    | { kind: 'add_tag'; tagId: string }
    | { kind: 'add_points'; points: number; reason?: string }
}

// Queues are created lazily and cached: constructing one opens a Redis connection under the
// async strategy, and a module-load-time connection would be opened by every process that
// merely imports this file, including the CLI.
let dispatchQueue: Queue<DispatchJob> | null = null
let resumeQueue: Queue<ResumeJob> | null = null
let sweepQueue: Queue<SweepJob> | null = null
let segmentActionQueue: Queue<SegmentActionJob> | null = null

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

export function getSegmentActionQueue(): Queue<SegmentActionJob> {
  // One at a time: a bulk action over a segment is a long write, and running several concurrently against
  // the same customers is how a frequency cap gets tested in production.
  segmentActionQueue ??= createModuleQueue<SegmentActionJob>(MARKETING_SEGMENT_ACTION_QUEUE, { concurrency: 1 })
  return segmentActionQueue
}

export async function enqueueSegmentAction(job: SegmentActionJob): Promise<void> {
  await getSegmentActionQueue().enqueue(job)
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
