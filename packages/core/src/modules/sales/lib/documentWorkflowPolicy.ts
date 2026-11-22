import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { salesDocumentWorkflowPolicySchema } from '../data/validators'
import type { z } from 'zod'

export type SalesDocumentWorkflowPolicy = z.infer<typeof salesDocumentWorkflowPolicySchema>
export type SalesDocumentWorkflowAction = keyof SalesDocumentWorkflowPolicy['allowedOrderStatuses']
export type SalesDocumentWorkflowScope = {
  tenantId: string
  organizationId: string
  status?: string | null
}
export type SalesDocumentWorkflowPolicyService = {
  getPolicy: (scope: SalesDocumentWorkflowScope) => unknown | Promise<unknown>
}

export function normalizeWorkflowStatus(status: string | null | undefined): string {
  return (status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function isSalesDocumentWorkflowGuardEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS, false)
}

export function createSalesDocumentWorkflowPolicy(): SalesDocumentWorkflowPolicyService {
  return {
    getPolicy: () => ({
      allowedOrderStatuses: {
        return: ['approved', 'confirmed', 'in_fulfillment', 'fulfilled'],
        shipment: ['approved', 'confirmed', 'in_fulfillment', 'fulfilled'],
        invoice: ['confirmed', 'in_fulfillment', 'fulfilled'],
      },
      returnableShipmentStatuses: ['shipped', 'in_transit', 'delivered'],
    }),
  }
}

export async function rejectSalesDocumentWorkflowAction(action: SalesDocumentWorkflowAction): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    code: 'sales_document_workflow_restricted',
    action,
    error: translate('sales.workflow.actionNotAllowed'),
  })
}

export async function enforceSalesDocumentWorkflowPolicy(
  ctx: CommandRuntimeContext,
  order: SalesDocumentWorkflowScope,
  action: SalesDocumentWorkflowAction,
): Promise<SalesDocumentWorkflowPolicy | null> {
  if (!isSalesDocumentWorkflowGuardEnabled()) return null
  const service = ctx.container.resolve<SalesDocumentWorkflowPolicyService>('salesDocumentWorkflowPolicy')
  if (typeof service?.getPolicy !== 'function') {
    throw new Error('[internal] Sales document workflow policy is unavailable')
  }
  const parsed = salesDocumentWorkflowPolicySchema.safeParse(await service.getPolicy({
    tenantId: order.tenantId,
    organizationId: order.organizationId,
    status: order.status,
  }))
  if (!parsed.success) throw new Error('[internal] Sales document workflow policy is invalid')
  const status = normalizeWorkflowStatus(order.status)
  if (!parsed.data.allowedOrderStatuses[action].some((allowed) => normalizeWorkflowStatus(allowed) === status)) {
    await rejectSalesDocumentWorkflowAction(action)
  }
  return parsed.data
}

export async function withSalesDocumentWorkflowTransaction<T>(
  em: EntityManager,
  operation: (transaction: EntityManager) => Promise<T>,
): Promise<T> {
  return isSalesDocumentWorkflowGuardEnabled() ? em.transactional(operation) : operation(em)
}
