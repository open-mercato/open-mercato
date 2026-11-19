import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE, getAgentOrchestratorQueue, type OtelExportJobPayload } from '../lib/queue'
import { processOtelExportJob } from '../lib/trace/otel/exportJob'
import { loadRunExportBundle } from '../lib/trace/otel/loadRunExportBundle'
import { postOtlpTraces } from '../lib/trace/otel/otlpHttpClient'

/**
 * Exports one terminal agent run to the configured OTLP/HTTP endpoint. The
 * payload carries the run id and attempt only; scope and the tenant opt-in are
 * re-read from the run row. Delivery is at-least-once with deterministic ids,
 * so a duplicate job re-sends identical spans.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE,
  id: 'agent_orchestrator:otel-export',
  concurrency: 2,
}

export default async function handle(job: QueuedJob<OtelExportJobPayload>, _ctx: JobContext): Promise<void> {
  const container = await createRequestContainer()
  await processOtelExportJob(job.payload, {
    container,
    loadBundle: (runId) => loadRunExportBundle((container.resolve('em') as EntityManager).fork(), runId),
    post: postOtlpTraces,
    enqueue: (payload, options) => getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE).enqueue(payload, options),
  })
}
