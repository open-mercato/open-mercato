import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/agentProcessProjection'

/**
 * Process projection Phase B (spec 2026-06-25): `workflows.instance.started`
 * re-fires on every step advance carrying `stepId`, which keeps `currentStage`
 * honest across NON-agent steps too. Update-only (`createIfMissing: false`) — a
 * process row exists only once an INVOKE_AGENT step produced agent activity, so
 * plain non-agent workflows never grow projection rows.
 */
export const metadata = {
  event: 'workflows.instance.started',
  persistent: true,
  id: 'agent_orchestrator:agent-process-workflow-started',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  await recomputeFromEvent(
    em,
    { ...record, processId: record.id },
    {
      createIfMissing: false,
      stageHint: typeof record.stepId === 'string' ? record.stepId : null,
      workflowId: typeof record.workflowId === 'string' ? record.workflowId : null,
      workflowVersion:
        record.version == null ? null : String(record.version),
    },
  )
}
