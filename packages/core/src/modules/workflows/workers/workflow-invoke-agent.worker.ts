/**
 * Workflow Invoke-Agent Worker
 *
 * Dedicated background worker for `invoke_agent` jobs. Agent runs hold a worker
 * slot for the entire LLM run (often minutes), so they get their own queue and
 * concurrency instead of sharing the 'workflow-activities' queue with fast
 * activities (timers, emails, API calls).
 *
 * This worker is auto-discovered by the queue system and processes jobs from
 * the 'workflow-invoke-agent' queue.
 */

import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { WorkflowActivityJob } from '../lib/activity-queue-types'
import { handleInvokeAgentJob } from '../lib/activity-worker-handler'

// Worker metadata for auto-discovery.
// NOTE: `queue` MUST be a string literal (or locally-declared const) so the
// generator's AST-based extractor can resolve it when Node cannot import the
// .ts source file directly. Importing `WORKFLOW_INVOKE_AGENT_QUEUE_NAME` from
// another module breaks auto-discovery and silently drops the worker from
// `modules.generated.ts`.
const WORKFLOW_INVOKE_AGENT_QUEUE = 'workflow-invoke-agent'
const DEFAULT_CONCURRENCY = 5
const envConcurrency = process.env.WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: WORKFLOW_INVOKE_AGENT_QUEUE,
  id: 'workflows:workflow-invoke-agent',
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Process an invoke_agent job.
 *
 * Delegates to `handleInvokeAgentJob`, which runs the agent OUTSIDE the
 * workflow transaction (this worker has its own connection) and resumes the
 * parked INVOKE_AGENT step via the proposal-ready signal.
 *
 * @param job - The queued job containing the invoke_agent payload
 * @param ctx - Job context with DI container access
 */
export default async function handle(
  job: QueuedJob<WorkflowActivityJob>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { payload } = job

  if (payload.kind !== 'invoke_agent') {
    console.warn(
      `[workflows:invoke-agent-worker] Skipping job ${ctx.jobId} with unexpected kind '${payload.kind ?? 'activity'}' on the ${WORKFLOW_INVOKE_AGENT_QUEUE} queue`
    )
    return
  }

  const em = ctx.resolve<EntityManager>('em')

  // Create a container-like object from ctx.resolve for the agent handler.
  // The ctx already has the resolve method we need, we just need to cast it
  const container = ctx as unknown as AwilixContainer

  await handleInvokeAgentJob(em, container, payload)
}
