import { createModuleQueue, type Queue } from '@open-mercato/queue'

export const AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE = 'agent-orchestrator-llm-judge'

/** F2: per-org metric rollup queue — the scheduler enqueues one job per org per interval. */
export const AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE = 'agent-orchestrator-metric-rollup'

/** Every process start (manual/API/schedule/event) starts its workflow via this queue — always async. */
export const AGENT_ORCHESTRATOR_PROCESS_EXECUTION_QUEUE = 'agent-process-executions'

/**
 * Eval suite replays. A dedicated queue (not the process-execution queue) so a large suite
 * cannot starve production dispatches — the two have separate concurrency lanes.
 */
export const AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE = 'agent-orchestrator-eval-suite'

export type LlmJudgeJobPayload = {
  runId: string
  scope: { tenantId: string; organizationId: string }
}

export type MetricRollupJobPayload = {
  scope: { tenantId: string; organizationId: string }
}

/**
 * Payload carries the executionId ONLY — the worker re-resolves tenant/org scope
 * from the ProcessInstance row itself, so a forged payload cannot cross tenants.
 */
export type ProcessExecutionJobPayload = {
  executionId: string
}

/**
 * Same rationale as ProcessExecutionJobPayload: the suite run id ONLY. The worker
 * re-resolves tenant/org scope from the AgentEvalSuiteRun row, so a forged
 * payload cannot cross tenants.
 */
export type EvalSuiteRunJobPayload = {
  suiteRunId: string
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
