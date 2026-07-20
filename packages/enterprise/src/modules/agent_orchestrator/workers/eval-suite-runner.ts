import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentEvalSuiteRun } from '../data/entities'
import { replaySuiteRun } from '../lib/eval/evalReplayService'
import { AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE, type EvalSuiteRunJobPayload } from '../lib/queue'
import type { CompleteEvalRunCommandInput, CompleteEvalRunCommandResult } from '../commands/evalRuns'

/**
 * Drains one suite run's pending case runs, then completes it.
 *
 * Tenant/org scope is re-resolved from the AgentEvalSuiteRun row, never trusted
 * from the payload — a forged `{ suiteRunId }` cannot reach another tenant's data
 * because the row lookup is the only source of scope.
 *
 * Idempotent per packages/queue/AGENTS.md: a retried job skips terminal rows, and
 * `replaySuiteRun` only picks up case runs still in `pending`, so cases already
 * executed by a previous attempt are not re-run (and not re-billed).
 *
 * Concurrency 1 on a DEDICATED queue: eval replays must not compete with the
 * production dispatch lane, and a suite's cases are sequential so a cancellation
 * takes effect at the next case boundary.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE,
  id: 'agent_orchestrator:eval-suite-runner',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<EvalSuiteRunJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const suiteRunId = job.payload?.suiteRunId
  if (!suiteRunId) return

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const suiteRun = await em.findOne(AgentEvalSuiteRun, { id: suiteRunId })
  if (!suiteRun) return
  if (suiteRun.status === 'completed' || suiteRun.status === 'cancelled') return

  const scope = { tenantId: suiteRun.tenantId, organizationId: suiteRun.organizationId }
  const triggeredBy = suiteRun.triggeredBy ?? ''

  const commandCtx: CommandRuntimeContext = {
    container,
    auth: { sub: triggeredBy, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    // No HTTP request behind a queue job; optimistic-lock headers do not apply.
    request: undefined,
  }

  try {
    await replaySuiteRun(container, suiteRunId, scope, triggeredBy)
  } catch (error) {
    // A suite-level failure is terminal for the suite, not retried forever: the
    // per-case failures are already isolated inside replaySuiteRun, so reaching
    // here means the suite itself is unusable.
    const failed = await em.findOne(AgentEvalSuiteRun, { id: suiteRunId, ...scope })
    if (failed && failed.status !== 'cancelled') {
      failed.status = 'failed'
      failed.finishedAt = new Date()
      await em.flush()
    }
    console.warn('[internal] agent_orchestrator: eval suite replay failed', { suiteRunId, error })
    return
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  await commandBus.execute<CompleteEvalRunCommandInput, CompleteEvalRunCommandResult>(
    'agent_orchestrator.evalRuns.complete',
    { input: { ...scope, suiteRunId }, ctx: commandCtx },
  )
}
