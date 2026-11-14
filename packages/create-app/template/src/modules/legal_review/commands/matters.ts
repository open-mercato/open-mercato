import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { legalMatterReleaseSchema, type LegalMatterReleaseInput } from '../data/validators'
import { LEGAL_MATTER_RELEASE_COMMAND_ID } from '../lib/constants'
import { releaseLegalMatter, type LegalMatterReleaseResult } from '../lib/release'

const releaseResultSchema = z.object({
  matterId: z.string().uuid(),
  stage: z.string(),
  released: z.boolean(),
})

function resolveScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Tenant and organization scope are required' })
  }
  return { tenantId, organizationId }
}

/**
 * Workflow-safe command: advances a matter to `released` once its document
 * review has cleared. Idempotent — see `releaseLegalMatter`.
 */
export const releaseLegalMatterCommand: CommandHandler<LegalMatterReleaseInput, LegalMatterReleaseResult> = {
  id: LEGAL_MATTER_RELEASE_COMMAND_ID,
  outputSchema: releaseResultSchema,
  async execute(rawInput, ctx) {
    const input = legalMatterReleaseSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await releaseLegalMatter(em, resolveScope(ctx), input.matterId)
    if (!result) throw new CrudHttpError(404, { error: '[internal] Legal matter not found' })
    return result
  },
}

registerCommand(releaseLegalMatterCommand)
