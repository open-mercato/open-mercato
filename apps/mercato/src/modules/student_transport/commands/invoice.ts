import { registerCommand, type CommandBus, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { multiplyDecimalStrings, roundDecimalHalfUp } from '../../financial/lib/money'
import { StudentSubscription } from '../data/entities'
import { invoiceSubscriptionSchema } from '../data/validators'
import { raiseStudentError } from '../lib/errors'
import { resolveScope } from './crud'
import {
  STUDENT_SUBSCRIPTION_ENTITY_ID,
  studentSubscriptionEvents,
  studentSubscriptionIndexer,
} from './entities'

const logger = createLogger('student_transport')

export const SUBSCRIPTION_INVOICE_COMMAND_ID = 'student_transport.subscriptions.invoice'

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
}

/**
 * Invoices one subscription period. Repeating the same period returns the
 * existing invoice; a different period is billed once and tracked on the
 * subscription so a second call cannot double-bill the same span.
 */
const invoiceSubscriptionCommand: CommandHandler<
  ReturnType<typeof invoiceSubscriptionSchema.parse>,
  { subscriptionId: string; salesOrderId: string; salesInvoiceId: string; periodFrom: string; periodTo: string }
> = {
  id: SUBSCRIPTION_INVOICE_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = invoiceSubscriptionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const subscription = await em.findOne(StudentSubscription, {
      id: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!subscription) return raiseStudentError(404, 'subscription_not_found', 'Subscription not found.')
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: STUDENT_SUBSCRIPTION_ENTITY_ID,
      resourceId: subscription.id,
      current: subscription.updatedAt,
      request: ctx.request ?? null,
    })
    if (subscription.status === 'draft' || subscription.status === 'suspended') {
      return raiseStudentError(409, 'subscription_not_billable', 'Only an active or ended subscription can be invoiced.')
    }
    const net = Number(subscription.periodPrice)
    if (!Number.isFinite(net) || net <= 0) {
      return raiseStudentError(409, 'subscription_price_missing', 'The subscription has no period price.')
    }

    const today = new Date()
    const rawFrom = input.periodFrom ? new Date(input.periodFrom) : startOfMonth(today)
    const rawTo = input.periodTo ? new Date(input.periodTo) : endOfMonth(rawFrom)
    if (Number.isNaN(rawFrom.getTime()) || Number.isNaN(rawTo.getTime()) || rawFrom > rawTo) {
      return raiseStudentError(400, 'billing_period_invalid', 'The billing period is invalid.')
    }
    const subscriptionFrom = subscription.startDate ? new Date(subscription.startDate) : null
    const subscriptionTo = subscription.endDate ? new Date(subscription.endDate) : null
    if ((subscriptionFrom && rawFrom < subscriptionFrom) || (subscriptionTo && rawTo > subscriptionTo)) {
      return raiseStudentError(409, 'billing_period_outside_subscription', 'The billing period falls outside the subscription.')
    }
    const periodFrom = isoDate(rawFrom) as string
    const periodTo = isoDate(rawTo) as string
    const previousFrom = isoDate(subscription.lastInvoicedPeriodFrom)
    const previousTo = isoDate(subscription.lastInvoicedPeriodTo)
    if (previousFrom === periodFrom && previousTo === periodTo && subscription.salesInvoiceId) {
      return {
        subscriptionId: subscription.id,
        salesOrderId: subscription.salesOrderId ?? '',
        salesInvoiceId: subscription.salesInvoiceId,
        periodFrom,
        periodTo,
      }
    }
    if (previousFrom && previousTo && periodFrom <= previousTo && periodTo >= previousFrom) {
      return raiseStudentError(409, 'billing_period_overlap', 'That period overlaps an already invoiced period.')
    }

    const taxRate = Number(subscription.taxRate)
    const taxAmount = roundDecimalHalfUp(multiplyDecimalStrings(subscription.periodPrice, taxRate / 100), 2)
    const grossAmount = roundDecimalHalfUp(
      String(Number(subscription.periodPrice) + Number(taxAmount)),
      2,
    )
    const line = {
      kind: 'service' as const,
      name: `Student transport — ${subscription.studentName}`,
      description: `Period ${periodFrom} – ${periodTo}`,
      currencyCode: subscription.currencyCode,
      quantity: 1,
      unitPriceNet: subscription.periodPrice,
      taxRate,
      taxAmount,
      totalNetAmount: subscription.periodPrice,
      totalGrossAmount: grossAmount,
      metadata: { source: 'student_transport', subscriptionId: subscription.id, periodFrom, periodTo },
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const scrubbedCtx = { ...ctx, request: undefined }
    let salesOrderId: string
    let salesInvoiceId: string
    try {
      const order = await commandBus.execute<Record<string, unknown>, { orderId: string }>('sales.orders.create', {
        input: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          customerEntityId: subscription.customerId,
          currencyCode: subscription.currencyCode,
          externalReference: `student:${subscription.subscriptionNumber}:${periodFrom}`.slice(0, 191),
          metadata: { source: 'student_transport', subscriptionId: subscription.id, periodFrom, periodTo },
          ...(input.channelId ? { channelId: input.channelId } : {}),
          ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
          lines: [line],
        },
        ctx: scrubbedCtx,
      })
      salesOrderId = order.result.orderId
      const invoice = await commandBus.execute<Record<string, unknown>, { invoiceId: string }>('sales.invoices.create', {
        input: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          orderId: salesOrderId,
          currencyCode: subscription.currencyCode,
          issueDate: new Date(),
          ...(input.dueAt ? { dueDate: new Date(input.dueAt) } : {}),
          lines: [line],
          subtotalNetAmount: subscription.periodPrice,
          taxTotalAmount: taxAmount,
          grandTotalNetAmount: subscription.periodPrice,
          grandTotalGrossAmount: grossAmount,
          outstandingAmount: grossAmount,
          metadata: { source: 'student_transport', subscriptionId: subscription.id, periodFrom, periodTo },
        },
        ctx: scrubbedCtx,
      })
      salesInvoiceId = invoice.result.invoiceId
    } catch (err) {
      if (isCrudHttpError(err)) throw err
      logger.error('student_transport.invoice_bridge.failed', { err, subscriptionId: subscription.id })
      return raiseStudentError(500, 'sales_bridge_failed', 'The invoice could not be created in the sales ledger.')
    }

    subscription.salesOrderId = salesOrderId
    subscription.salesInvoiceId = salesInvoiceId
    subscription.lastInvoicedPeriodFrom = new Date(`${periodFrom}T00:00:00.000Z`)
    subscription.lastInvoicedPeriodTo = new Date(`${periodTo}T00:00:00.000Z`)
    subscription.updatedAt = new Date()
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: subscription,
      identifiers: { id: subscription.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: studentSubscriptionEvents,
      indexer: studentSubscriptionIndexer,
    })
    return { subscriptionId: subscription.id, salesOrderId, salesInvoiceId, periodFrom, periodTo }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Invoice student subscription',
      resourceKind: STUDENT_SUBSCRIPTION_ENTITY_ID,
      resourceId: result.subscriptionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(invoiceSubscriptionCommand)

export { invoiceSubscriptionCommand }
