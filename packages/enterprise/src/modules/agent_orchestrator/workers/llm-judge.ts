import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE, type LlmJudgeJobPayload } from '../lib/queue'
import { createModelJudge, runLlmJudgeForRun } from '../lib/eval/llmJudge'

/**
 * Async, sampled, warn-only llm_judge tier (gap-04/08/09). Enqueued from the
 * trace ingest command for a sampled subset of runs; scores each run's output
 * against the tenant's enabled llm_judge assertions and appends warn results.
 * Never on the critical path — a model/provider failure only logs (the run's
 * gate verdict already stands).
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE,
  id: 'agent_orchestrator:llm-judge',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<LlmJudgeJobPayload>, _ctx: JobContext): Promise<void> {
  const { runId, scope } = job.payload
  if (!runId || !scope?.tenantId || !scope?.organizationId) return

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  try {
    await runLlmJudgeForRun(em, scope, runId, createModelJudge(container))
  } catch (error) {
    // Warn-only tier: a judge/provider failure must not fail the job loudly or
    // affect the run's gate verdict. Log and move on.
    console.warn('[internal] agent_orchestrator: llm_judge scoring failed', { runId, error })
  }
}
