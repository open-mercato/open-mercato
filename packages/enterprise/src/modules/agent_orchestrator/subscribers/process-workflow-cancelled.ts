import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/processProjection'
import { enqueueOtelExportForFinishedProcessEvent } from '../lib/trace/otel/finishedProcessExport'

/** Terminal resolution: a cancelled instance → `cancelled`. */
export const metadata = {
  event: 'workflows.instance.cancelled',
  persistent: true,
  id: 'agent_orchestrator:process-workflow-cancelled',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  const result = await recomputeFromEvent(
    em,
    { ...record, workflowInstanceId: record.id },
    { createIfMissing: false, terminal: 'cancelled' },
  )
  if (!result) return
  await enqueueOtelExportForFinishedProcessEvent(em, ctx, { ...record, workflowInstanceId: record.id })
}
