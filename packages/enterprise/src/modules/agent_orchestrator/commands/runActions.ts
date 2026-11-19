import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentRun } from '../data/entities'

const toggleRunFlagSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentRunId: z.string().uuid(),
  userId: z.string().uuid(),
})
export type ToggleRunFlagCommandInput = z.infer<typeof toggleRunFlagSchema>
export type ToggleRunFlagCommandResult = { flagged: boolean; flaggedAt: string | null }

/**
 * Trace-inspector "Flag": toggle the operator triage flag on a run. Flagging
 * stamps `flaggedAt`/`flaggedBy`; a repeat call clears both. Audited via the
 * Command path like every other run mutation.
 */
export const toggleRunFlagCommand: CommandHandler<ToggleRunFlagCommandInput, ToggleRunFlagCommandResult> = {
  id: 'agent_orchestrator.runs.toggleFlag',
  async execute(rawInput, ctx) {
    const input = toggleRunFlagSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(AgentRun, {
      id: input.agentRunId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    })
    if (!run) throw new CrudHttpError(404, { error: '[internal] run not found' })

    if (run.flaggedAt) {
      run.flaggedAt = null
      run.flaggedBy = null
    } else {
      run.flaggedAt = new Date()
      run.flaggedBy = input.userId
    }
    run.updatedAt = new Date()
    await em.flush()

    return {
      flagged: run.flaggedAt != null,
      flaggedAt: run.flaggedAt ? run.flaggedAt.toISOString() : null,
    }
  },
}

registerCommand(toggleRunFlagCommand)
