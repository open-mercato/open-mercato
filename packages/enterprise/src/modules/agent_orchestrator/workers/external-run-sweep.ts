import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ExternalRunSweepJobPayload } from '../lib/queue'
import { runExternalRunSweepJob } from '../lib/runtime/externalRunSweep'

const logger = createLogger('agent_orchestrator').child({ worker: 'external-run-sweep' })

/**
 * The callback deadline enforcer (design §5.5, risk R2; tracker task 2.7): a
 * phone call nobody answers must never leave a workflow parked forever.
 *
 * Serves both arms of the sweep — the targeted delayed job `ExternalAgentRunner`
 * enqueues when it places a call, and the per-organization periodic tick
 * `setup.ts` registers with the scheduler. `lib/runtime/externalRunSweep.ts`
 * explains why both ship and why running both is free.
 *
 * Idempotent per `packages/queue/AGENTS.md`, and it has to be: expiry resumes a
 * workflow step, so a second execution of the same job would advance a business
 * process twice. What prevents that is not this worker but the conditional
 * `pending → terminal` claim inside `completeExternalRun`, the same gate a
 * redelivered provider webhook passes through. Tenant/org scope is re-read from
 * the correlation row, never trusted from the payload.
 */
// NOTE: `queue` MUST be a string literal (or a const declared in THIS file) — the
// generator's AST extractor resolves identifiers only against local declarations,
// so importing the name would silently drop this worker from
// `modules.generated.ts` and leave the deadline unenforced. A test asserts this
// literal still matches AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE.
const AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE = 'agent-orchestrator-external-run-sweep'

export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE,
  id: 'agent_orchestrator:external-run-sweep',
  // One at a time. Each job holds a pooled DB connection for its duration and the
  // work is latency-bound on `sendSignal` and an outbound `cancel`, not on this
  // process — and expiries are rare by construction (they are the calls that went
  // wrong). Parallelism here would only spend connection budget that real agent
  // runs need.
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<ExternalRunSweepJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    await runExternalRunSweepJob({ container, commandBus }, job.payload)
  } catch (error) {
    // Let the queue retry: unlike the metric rollup, which has a live fallback,
    // nothing else will free these steps. A retry re-reads the row and finds it
    // already settled if a callback won in the meantime.
    logger.error('external run deadline sweep failed', {
      externalRunRowId: job.payload?.externalRunRowId ?? null,
      scope: job.payload?.scope ?? null,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
