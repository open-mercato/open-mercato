import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { raiseFreightError } from './errors'
import type { FreightInvoiceDraft } from './invoiceDraft'

/**
 * The freight → sales money bridge.
 *
 * Core constraints shape this module (verified in the sales command layer):
 * a `SalesInvoice` has no customer column and `sales.payments.create` requires
 * an order, so every freight invoice is an order → invoice pair created through
 * the command bus with a scrubbed dispatch context — the sanctioned cross-module
 * pattern. Payment recording recomputes only *order* totals, so the invoice's
 * paid/outstanding are synced explicitly and the caller surfaces a resync action
 * when that sync fails.
 */

const logger = createLogger('freight_operations')

export type BridgeScope = { tenantId: string; organizationId: string }

export type FreightInvoiceBridgeInput = {
  tenantId: string
  organizationId: string
  customerEntityId: string
  currencyCode: string
  externalReference: string
  metadata: Record<string, unknown>
  dueAt?: Date | null
  channelId?: string | null
  draft: FreightInvoiceDraft
}

export type FreightInvoiceBridgeResult = {
  salesOrderId: string
  salesInvoiceId: string
  salesInvoiceNumber: string | null
}

function scrubbedDispatchContext(ctx: CommandRuntimeContext): CommandRuntimeContext {
  return { ...ctx, request: undefined }
}

function commandBusOf(ctx: CommandRuntimeContext): CommandBus {
  return ctx.container.resolve('commandBus') as CommandBus
}

async function toBridgeError(err: unknown): Promise<never> {
  if (isCrudHttpError(err)) throw err
  logger.error('freight_operations.sales_bridge.failed', { err })
  return raiseFreightError(500, 'sales_bridge_failed', 'The invoice could not be created in the sales ledger.')
}

export async function createFreightSalesInvoice(
  ctx: CommandRuntimeContext,
  input: FreightInvoiceBridgeInput,
): Promise<FreightInvoiceBridgeResult> {
  const commandBus = commandBusOf(ctx)
  const scrubbed = scrubbedDispatchContext(ctx)

  const lines = input.draft.lines.map((line) => ({
    kind: 'service' as const,
    name: line.name,
    ...(line.description ? { description: line.description } : {}),
    currencyCode: input.currencyCode,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    totalNetAmount: line.totalNetAmount,
    totalGrossAmount: line.totalGrossAmount,
    ...(line.metadata ? { metadata: line.metadata } : {}),
  }))

  let salesOrderId: string
  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { orderId: string }>('sales.orders.create', {
      input: {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        customerEntityId: input.customerEntityId,
        currencyCode: input.currencyCode,
        externalReference: input.externalReference.slice(0, 191),
        metadata: input.metadata,
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        lines,
      },
      ctx: scrubbed,
    })
    salesOrderId = result.orderId
  } catch (err) {
    return toBridgeError(err)
  }

  try {
    const { result: invoiceResult } = await commandBus.execute<Record<string, unknown>, { invoiceId: string }>(
      'sales.invoices.create',
      {
        input: {
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          orderId: salesOrderId,
          currencyCode: input.currencyCode,
          issueDate: new Date(),
          ...(input.dueAt ? { dueDate: input.dueAt } : {}),
          lines,
          subtotalNetAmount: input.draft.subtotalNetAmount,
          taxTotalAmount: input.draft.taxTotalAmount,
          grandTotalNetAmount: input.draft.grandTotalNetAmount,
          grandTotalGrossAmount: input.draft.grandTotalGrossAmount,
          outstandingAmount: input.draft.grandTotalGrossAmount,
          metadata: input.metadata,
        },
        ctx: scrubbed,
      },
    )
    const salesInvoiceNumber = await readSalesInvoiceNumber(ctx, input, invoiceResult.invoiceId)
    return { salesOrderId, salesInvoiceId: invoiceResult.invoiceId, salesInvoiceNumber }
  } catch (err) {
    try {
      await commandBus.execute('sales.orders.delete', {
        input: { id: salesOrderId },
        ctx: scrubbed,
      })
    } catch (compensationErr) {
      logger.error('freight_operations.sales_bridge.compensation_failed — orphaned sales order', {
        err: compensationErr,
        salesOrderId,
        externalReference: input.externalReference,
      })
    }
    return toBridgeError(err)
  }
}

export async function deleteSalesOrderQuietly(
  ctx: CommandRuntimeContext,
  salesOrderId: string,
): Promise<void> {
  try {
    await commandBusOf(ctx).execute('sales.orders.delete', {
      input: { id: salesOrderId },
      ctx: scrubbedDispatchContext(ctx),
    })
  } catch (err) {
    logger.error('freight_operations.sales_bridge.order_cleanup_failed — orphaned sales order', { err, salesOrderId })
  }
}

export async function deleteSalesInvoiceQuietly(
  ctx: CommandRuntimeContext,
  scope: BridgeScope,
  salesInvoiceId: string,
): Promise<void> {
  try {
    await commandBusOf(ctx).execute('sales.invoices.delete', {
      input: { id: salesInvoiceId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      ctx: scrubbedDispatchContext(ctx),
    })
  } catch (err) {
    logger.error('freight_operations.sales_bridge.invoice_cleanup_failed — orphaned sales invoice', { err, salesInvoiceId })
  }
}

export async function readSalesInvoiceNumber(
  ctx: CommandRuntimeContext,
  scope: BridgeScope,
  salesInvoiceId: string,
): Promise<string | null> {
  const reference = await readSalesInvoiceReference(ctx, scope, salesInvoiceId)
  return reference?.invoiceNumber ?? null
}

export type SalesInvoiceReference = {
  invoiceNumber: string | null
  grandTotalGrossAmount: string
}

export async function readSalesInvoiceReference(
  ctx: CommandRuntimeContext,
  scope: BridgeScope,
  salesInvoiceId: string,
): Promise<SalesInvoiceReference | null> {
  try {
    const em = ctx.container.resolve('em') as EntityManager
    const rows = await em.getConnection().execute<{ invoice_number: string | null; grand_total_gross_amount: string | null }[]>(
      `select invoice_number, grand_total_gross_amount from sales_invoices
       where id = ? and tenant_id = ? and organization_id = ? limit 1`,
      [salesInvoiceId, scope.tenantId, scope.organizationId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      invoiceNumber: row.invoice_number ?? null,
      grandTotalGrossAmount: row.grand_total_gross_amount ?? '0',
    }
  } catch (err) {
    logger.warn('freight_operations.sales_bridge.invoice_read_failed', { err, salesInvoiceId })
    return null
  }
}

export type RecordSalesPaymentInput = {
  tenantId: string
  organizationId: string
  orderId: string
  invoiceId: string
  amount: string
  currencyCode: string
  reference?: string | null
  receivedAt: Date
  metadata?: Record<string, unknown>
}

export async function recordSalesPayment(
  ctx: CommandRuntimeContext,
  input: RecordSalesPaymentInput,
): Promise<{ salesPaymentId: string }> {
  const commandBus = commandBusOf(ctx)
  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { paymentId: string }>(
      'sales.payments.create',
      {
        input: {
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          orderId: input.orderId,
          amount: input.amount,
          currencyCode: input.currencyCode,
          ...(input.reference ? { paymentReference: input.reference } : {}),
          receivedAt: input.receivedAt,
          allocations: [
            {
              orderId: input.orderId,
              invoiceId: input.invoiceId,
              amount: input.amount,
              currencyCode: input.currencyCode,
            },
          ],
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        ctx: scrubbedDispatchContext(ctx),
      },
    )
    return { salesPaymentId: result.paymentId }
  } catch (err) {
    return toBridgeError(err)
  }
}

export async function voidSalesPayment(
  ctx: CommandRuntimeContext,
  scope: BridgeScope,
  salesPaymentId: string,
): Promise<void> {
  const commandBus = commandBusOf(ctx)
  try {
    await commandBus.execute('sales.payments.delete', {
      input: { id: salesPaymentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      ctx: scrubbedDispatchContext(ctx),
    })
  } catch (err) {
    // Idempotent by design: a retry after a partial failure finds the sales
    // payment already gone, and that is a success, not an error.
    if (isCrudHttpError(err) && err.status === 404) return
    return toBridgeError(err)
  }
}

export type SyncInvoiceTotalsInput = {
  tenantId: string
  organizationId: string
  invoiceId: string
  paidTotalAmount: string
  outstandingAmount: string
}

export async function syncSalesInvoiceTotals(
  ctx: CommandRuntimeContext,
  input: SyncInvoiceTotalsInput,
): Promise<boolean> {
  const commandBus = commandBusOf(ctx)
  try {
    await commandBus.execute('sales.invoices.update', {
      input: {
        id: input.invoiceId,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        paidTotalAmount: Number(input.paidTotalAmount),
        outstandingAmount: Number(input.outstandingAmount),
      },
      ctx: scrubbedDispatchContext(ctx),
    })
    return true
  } catch (err) {
    logger.warn('freight_operations.sales_bridge.invoice_sync_failed', { err, invoiceId: input.invoiceId })
    return false
  }
}
