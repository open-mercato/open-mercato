export const metadata = {
  event: 'inbox_ops.action.executed',
  persistent: true,
  id: 'inbox_ops:execution-auditor',
}

interface ActionExecutedPayload {
  actionId: string
  proposalId: string
  actionType: string
  createdEntityId: string | null
  createdEntityType: string | null
  executedByUserId: string
  tenantId: string
  organizationId: string | null
}

interface DataEngineWithAudit {
  audit?: (entry: {
    action: string
    resourceKind: string
    resourceId: string
    userId: string
    tenantId: string
    organizationId: string | null
    payload: Record<string, unknown>
  }) => Promise<void>
}

interface ResolverContext {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: ActionExecutedPayload, ctx: ResolverContext) {
  try {
    const dataEngine = ctx.resolve<DataEngineWithAudit>('dataEngine')
    if (!dataEngine?.audit) return

    await dataEngine.audit({
      action: 'inbox_ops.action.executed',
      resourceKind: `inbox_ops.${payload.actionType}`,
      resourceId: payload.actionId,
      userId: payload.executedByUserId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      payload: {
        proposalId: payload.proposalId,
        actionType: payload.actionType,
        createdEntityId: payload.createdEntityId,
        createdEntityType: payload.createdEntityType,
      },
    })
  } catch (err) {
    console.error('[inbox_ops:execution-auditor] Failed to write audit log:', err)
    throw err
  }
}
