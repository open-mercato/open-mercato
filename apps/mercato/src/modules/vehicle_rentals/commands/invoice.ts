import { registerCommand, type CommandBus, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { RentalContract } from '../data/entities'
import { invoiceRentalSchema, type InvoiceRentalInput } from '../data/validators'
import { raiseRentalError } from '../lib/errors'
import { resolveScope } from './crud'
import {
  RENTAL_CONTRACT_ENTITY_ID,
  rentalContractEvents,
  rentalContractIndexer,
} from './entities'

const logger = createLogger('vehicle_rentals')

export const RENTAL_INVOICE_COMMAND_ID = 'vehicle_rentals.contracts.invoice'

/**
 * Creates the sales order and invoice pair for a completed rental.
 *
 * The contract keeps the two ids, so a retry returns the same invoice instead
 * of billing the customer twice. `sales.orders.create` + `sales.invoices.create`
 * are the sanctioned cross-module write path.
 */
const invoiceRentalCommand: CommandHandler<InvoiceRentalInput, { rentalId: string; salesOrderId: string; salesInvoiceId: string }> = {
  id: RENTAL_INVOICE_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = invoiceRentalSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const contract = await em.findOne(RentalContract, {
      id: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!contract) return raiseRentalError(404, 'rental_not_found', 'Rental contract not found.')
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: RENTAL_CONTRACT_ENTITY_ID,
      resourceId: contract.id,
      current: contract.updatedAt,
      request: ctx.request ?? null,
    })
    if (contract.status !== 'completed') {
      return raiseRentalError(409, 'rental_not_completed', 'Only a completed rental can be invoiced.')
    }
    const net = Number(contract.totalNetAmount)
    if (!Number.isFinite(net) || net <= 0) {
      return raiseRentalError(409, 'rental_amount_missing', 'The rental has no billable amount.')
    }
    if (contract.salesInvoiceId) {
      return {
        rentalId: contract.id,
        salesOrderId: contract.salesOrderId ?? '',
        salesInvoiceId: contract.salesInvoiceId,
      }
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const line = {
      kind: 'service' as const,
      name: `Rental ${contract.rentalNumber}`,
      description: 'Vehicle rental including extra kilometres',
      currencyCode: contract.currencyCode,
      quantity: 1,
      unitPriceNet: contract.totalNetAmount,
      taxRate: Number(contract.taxRate),
      taxAmount: contract.taxAmount,
      totalNetAmount: contract.totalNetAmount,
      totalGrossAmount: contract.totalGrossAmount,
      metadata: { source: 'vehicle_rentals', contractId: contract.id },
    }
    const scrubbedCtx = { ...ctx, request: undefined }
    let salesOrderId: string
    let salesInvoiceId: string
    try {
      const order = await commandBus.execute<Record<string, unknown>, { orderId: string }>('sales.orders.create', {
        input: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          customerEntityId: contract.customerId,
          currencyCode: contract.currencyCode,
          externalReference: `rental:${contract.rentalNumber}`.slice(0, 191),
          metadata: { source: 'vehicle_rentals', contractId: contract.id },
          ...(input.channelId ? { channelId: input.channelId } : {}),
          ...(input.dueAt ? { dueAt: new Date(String(input.dueAt)) } : {}),
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
          currencyCode: contract.currencyCode,
          issueDate: new Date(),
          ...(input.dueAt ? { dueDate: new Date(String(input.dueAt)) } : {}),
          lines: [line],
          subtotalNetAmount: contract.totalNetAmount,
          taxTotalAmount: contract.taxAmount,
          grandTotalNetAmount: contract.totalNetAmount,
          grandTotalGrossAmount: contract.totalGrossAmount,
          outstandingAmount: contract.totalGrossAmount,
          metadata: { source: 'vehicle_rentals', contractId: contract.id },
        },
        ctx: scrubbedCtx,
      })
      salesInvoiceId = invoice.result.invoiceId
    } catch (err) {
      if (isCrudHttpError(err)) throw err
      logger.error('vehicle_rentals.invoice_bridge.failed', { err, rentalId: contract.id })
      return raiseRentalError(500, 'sales_bridge_failed', 'The invoice could not be created in the sales ledger.')
    }

    contract.salesOrderId = salesOrderId
    contract.salesInvoiceId = salesInvoiceId
    contract.updatedAt = new Date()
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: contract,
      identifiers: { id: contract.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: rentalContractEvents,
      indexer: rentalContractIndexer,
    })
    return { rentalId: contract.id, salesOrderId, salesInvoiceId }
  },
  buildLog: ({ input, result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Invoice rental contract',
      resourceKind: RENTAL_CONTRACT_ENTITY_ID,
      resourceId: result.rentalId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      payload: { input },
    }
  },
}

registerCommand(invoiceRentalCommand)

export { invoiceRentalCommand }
