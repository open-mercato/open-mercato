import { AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE, getAgentOrchestratorQueue } from '../lib/queue'
import { enqueueOtelExportForRunEvent } from '../lib/trace/otel/exportJob'

export const metadata = {
  event: 'agent_orchestrator.run.ingested',
  persistent: true,
  id: 'agent_orchestrator:otel-export-run-ingested',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  await enqueueOtelExportForRunEvent(payload, ctx, {
    enqueue: (job, options) => getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE).enqueue(job, options),
  })
}
