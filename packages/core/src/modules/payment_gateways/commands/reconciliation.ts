import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { reconciliationResolutionSchema, type ReconciliationResolution } from '../data/validators'
import { resolveReconciliation } from '../lib/reconciliation'
import { resolvePaymentGatewayTranslator } from '../lib/order-amount-reconciliation'

type Input = { id: string; evidence: ReconciliationResolution }
type Result = Awaited<ReturnType<typeof resolveReconciliation>>

export const resolveReconciliationCommand: CommandHandler<Input, Result> = {
  id: 'payment_gateways.reconciliation.resolve',
  isUndoable: false,
  async execute(input, ctx) {
    const translate = await resolvePaymentGatewayTranslator()
    const auth = ctx.auth
    if (!auth?.tenantId || !auth.orgId || !auth.sub) {
      throw new CrudHttpError(401, { error: translate('payment_gateways.reconciliation.errors.unauthorized') })
    }
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const rbac = ctx.container.resolve<RbacService>('rbacService')
    if (auth.isApiKey || !await rbac.userHasAllFeatures(auth.sub, ['payment_gateways.refund'], scope)) {
      throw new CrudHttpError(403, { error: translate('payment_gateways.reconciliation.errors.forbidden') })
    }
    return resolveReconciliation(ctx.container.resolve<EntityManager>('em'), {
      id: input.id, evidence: reconciliationResolutionSchema.parse(input.evidence),
      actorUserId: auth.sub, scope, container: ctx.container, request: ctx.request,
    })
  },
  async buildLog({ result }) {
    const translate = await resolvePaymentGatewayTranslator()
    return {
      actionLabel: translate('payment_gateways.reconciliation.resolve'),
      resourceKind: 'payment_gateways.payment_operation', resourceId: result.id,
      tenantId: result.tenantId, organizationId: result.organizationId,
      snapshotAfter: { status: result.reconciliation.status, resolvedBy: result.reconciliation.resolution?.actorUserId },
      replayable: false,
    }
  },
}

registerCommand(resolveReconciliationCommand)
