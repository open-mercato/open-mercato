import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentExternalRun } from '../data/entities'
import { agentExternalRunSchema } from '../data/validators'

/**
 * The correlation row that links a suspended `AgentRun` to the external provider
 * answering it later (external-agent-invocation design §5.5).
 *
 * It is written through a Command rather than a raw `em.flush()` for a reason
 * that is enforced at runtime, not merely stylistic: an `INVOKE_AGENT` run bound
 * to a provisioned agent principal executes inside `withAgentActor`, and
 * `AgentKindNoBypassSubscriber` throws on ANY flush under that scope that is not
 * nested in `withAuditedCommand`. Its own docstring names "the token-bearing
 * external case" as the case it exists for. A raw write here would therefore fail
 * closed at flush time for exactly the agents this table is built for.
 */
const createAgentExternalRunSchema = z.intersection(
  z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid(),
  }),
  agentExternalRunSchema,
)
export type CreateAgentExternalRunInput = z.infer<typeof createAgentExternalRunSchema>

export const createAgentExternalRunCommand: CommandHandler<
  CreateAgentExternalRunInput,
  { externalRunRowId: string }
> = {
  id: 'agent_orchestrator.external_runs.create',
  async execute(rawInput, ctx) {
    const input = createAgentExternalRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const row = em.create(AgentExternalRun, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      runId: input.runId,
      agentId: input.agentId,
      connectorId: input.connectorId,
      // Only the digest — `agentExternalRunSchema` rejects anything that is not a
      // lowercase SHA-256 hex string, so the plaintext bearer cannot land here by
      // accident and a dump of this table yields no forgeable callback.
      callbackTokenHash: input.callbackTokenHash,
      externalRunId: input.externalRunId ?? null,
      processId: input.processId ?? null,
      stepId: input.stepId ?? null,
      signalName: input.signalName ?? null,
      status: input.status,
      expiresAt: input.expiresAt,
      requestPayload: input.requestPayload ?? null,
      resultPayload: input.resultPayload ?? null,
      failureReason: input.failureReason ?? null,
    })
    em.persist(row)
    await em.flush()
    return { externalRunRowId: row.id }
  },
}

registerCommand(createAgentExternalRunCommand)
