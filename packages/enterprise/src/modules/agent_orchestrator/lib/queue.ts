import { createModuleQueue, type Queue } from '@open-mercato/queue'

export const AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE = 'agent-orchestrator-llm-judge'

/** F2: per-org metric rollup queue — the scheduler enqueues one job per org per interval. */
export const AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE = 'agent-orchestrator-metric-rollup'

export type LlmJudgeJobPayload = {
  runId: string
  scope: { tenantId: string; organizationId: string }
}

export type MetricRollupJobPayload = {
  scope: { tenantId: string; organizationId: string }
}

const queues = new Map<string, Queue<Record<string, unknown>>>()

/** Lazily create/reuse a module queue (concurrency from env, default 1). */
export function getAgentOrchestratorQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing
  const concurrency = Math.max(
    1,
    Number.parseInt(process.env.AGENT_ORCHESTRATOR_QUEUE_CONCURRENCY ?? '1', 10) || 1,
  )
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}
