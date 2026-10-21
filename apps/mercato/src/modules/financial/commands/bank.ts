import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { matchBankStatement } from '../lib/bankReconciliation'

type Scope = { tenantId: string; organizationId: string }

function resolveScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new Error('[internal] Tenant and organization context are required.')
  return { tenantId, organizationId }
}

const matchBankStatementCommand: CommandHandler<{ id: string }, { matched: number; unmatched: number }> = {
  id: 'financial.bank_statements.match',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return matchBankStatement(em, scope, input.id)
  },
}

registerCommand(matchBankStatementCommand)
