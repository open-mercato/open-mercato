import { createModuleQueue, type Queue } from '@open-mercato/queue'

export const AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE = 'agent-orchestrator-llm-judge'

/** F2: per-org metric rollup queue — the scheduler enqueues one job per org per interval. */
export const AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE = 'agent-orchestrator-metric-rollup'

/** Every `/process-definitions/:id/run` (manual/API/schedule/event) executes via this queue — always async. */
export const AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE = 'agent-process-runs'

/**
 * Eval suite replays. A dedicated queue (not the process-run queue) so a large suite
 * cannot starve production dispatches — the two have separate concurrency lanes.
 */
export const AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE = 'agent-orchestrator-eval-suite'

/**
 * External-run deadline sweep (design §5.5 / risk R2; tracker task 2.7). Carries
 * BOTH arms of the sweep — the targeted delayed job the runner enqueues at
 * `start()` and the per-organization periodic tick the scheduler fires — because
 * they converge on the same expiry and a second queue would only split their
 * concurrency lane for no gain. Kept off the process-run queue so a backlog of
 * deadlines cannot starve real dispatches.
 *
 * NOTE: `workers/external-run-sweep.ts` re-declares this name as a LOCAL string
 * literal (the generator's AST extractor cannot resolve an imported one) and
 * `__tests__/external-run-expiry.test.ts` asserts the two still agree.
 */
export const AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE = 'agent-orchestrator-external-run-sweep'

export type LlmJudgeJobPayload = {
  runId: string
  scope: { tenantId: string; organizationId: string }
}

export type MetricRollupJobPayload = {
  scope: { tenantId: string; organizationId: string }
}

/**
 * Two shapes on one queue, discriminated by `externalRunRowId`.
 *
 * TARGETED (`externalRunRowId` + its scope): enqueued with `delayMs` by
 * `ExternalAgentRunner` when the call is placed, so one specific run is checked
 * at the instant its deadline passes. The scope travels so the row read is
 * tenant-scoped in SQL; the settlement scope is still taken from the row itself,
 * so a forged payload addresses nothing.
 *
 * PERIODIC (`scope` only): the per-organization scheduler tick, which sweeps
 * every `pending` row past its deadline in that organization. This is the
 * self-healing half — it needs no job to have survived and no job to have ever
 * been enqueued.
 */
export type ExternalRunSweepJobPayload = {
  externalRunRowId?: string
  scope: { tenantId: string; organizationId: string }
}

/**
 * Payload carries the processRunId ONLY — the worker re-resolves tenant/org scope
 * from the AgentProcessRun row itself, so a forged payload cannot cross tenants.
 */
export type AgentProcessRunJobPayload = {
  processRunId: string
}

/**
 * Same rationale as AgentProcessRunJobPayload: the suite run id ONLY. The worker
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
