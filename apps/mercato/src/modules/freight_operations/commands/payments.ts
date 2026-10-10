import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { FreightOrder, FreightPayment, FreightTripAbstract } from '../data/entities'
import {
  paymentSyncSchema,
  recordPaymentSchema,
  voidPaymentSchema,
  type RecordPaymentInput,
} from '../data/validators'
import { resolveScope } from './crud'
import { FREIGHT_ABSTRACT_ENTITY_ID, FREIGHT_ORDER_ENTITY_ID, FREIGHT_PAYMENT_ENTITY_ID } from './entities'
import { raiseFreightError } from '../lib/errors'
import type { FreightScope } from '../lib/freightSettings'
import { halalasToAmountString, toHalalas } from '../lib/money'
import {
  readSalesInvoiceReference,
  recordSalesPayment,
  syncSalesInvoiceTotals,
  voidSalesPayment,
} from '../lib/salesBridge'
import { emitFreightEvent } from '../events'

type AggregateRef =
  | { kind: 'order'; orderId: string; customerId: string; currencyCode: string; salesOrderId: string; salesInvoiceId: string }
  | { kind: 'abstract'; abstractId: string; customerId: string; currencyCode: string; salesOrderId: string; salesInvoiceId: string }

type SyncOutcome = {
  ok: boolean
  paidTotalAmount: string
  outstandingAmount: string | null
  invoiceNumber: string | null
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function loadAggregateRef(
  em: EntityManager,
  scope: FreightScope,
  input: { orderId?: string | null; abstractId?: string | null },
): Promise<AggregateRef | null> {
  if (input.orderId) {
    const order = await em.findOne(FreightOrder, {
      id: input.orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order || !order.salesOrderId || !order.salesInvoiceId) return null
    return {
      kind: 'order',
      orderId: order.id,
      customerId: order.customerId,
      currencyCode: order.currencyCode,
      salesOrderId: order.salesOrderId,
      salesInvoiceId: order.salesInvoiceId,
    }
  }
  if (input.abstractId) {
    const abstract = await em.findOne(FreightTripAbstract, {
      id: input.abstractId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!abstract || !abstract.salesOrderId || !abstract.salesInvoiceId) return null
    return {
      kind: 'abstract',
      abstractId: abstract.id,
      customerId: abstract.customerId,
      currencyCode: abstract.currencyCode,
      salesOrderId: abstract.salesOrderId,
      salesInvoiceId: abstract.salesInvoiceId,
    }
  }
  return null
}

async function loadAggregateForUpdate(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: FreightScope,
  input: { orderId?: string | null; abstractId?: string | null },
): Promise<AggregateRef> {
  if (input.orderId) {
    const order = await em.findOne(
      FreightOrder,
      { id: input.orderId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    if (!order) return raiseFreightError(404, 'order_not_found', 'Freight order not found.')
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: order.id,
      current: order.updatedAt,
      request: ctx.request ?? null,
    })
    if (!order.salesOrderId || !order.salesInvoiceId || order.status !== 'invoiced') {
      return raiseFreightError(409, 'order_not_invoiced', 'Payments can only be recorded against an invoiced order.')
    }
    return {
      kind: 'order',
      orderId: order.id,
      customerId: order.customerId,
      currencyCode: order.currencyCode,
      salesOrderId: order.salesOrderId,
      salesInvoiceId: order.salesInvoiceId,
    }
  }
  if (input.abstractId) {
    const abstract = await em.findOne(
      FreightTripAbstract,
      { id: input.abstractId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    if (!abstract) return raiseFreightError(404, 'abstract_not_found', 'Trip abstract not found.')
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: abstract.id,
      current: abstract.updatedAt,
      request: ctx.request ?? null,
    })
    if (!abstract.salesOrderId || !abstract.salesInvoiceId || abstract.status !== 'invoiced') {
      return raiseFreightError(409, 'abstract_not_invoiced', 'Payments can only be recorded against an invoiced abstract.')
    }
    return {
      kind: 'abstract',
      abstractId: abstract.id,
      customerId: abstract.customerId,
      currencyCode: abstract.currencyCode,
      salesOrderId: abstract.salesOrderId,
      salesInvoiceId: abstract.salesInvoiceId,
    }
  }
  return raiseFreightError(400, 'payment_target_required', 'A freight payment needs an order or an abstract.')
}

async function sumRecordedHalalas(em: EntityManager, scope: FreightScope, aggregate: AggregateRef): Promise<number> {
  const rows = await em.find(FreightPayment, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    ...(aggregate.kind === 'order' ? { orderId: aggregate.orderId } : { abstractId: aggregate.abstractId }),
  })
  let total = 0
  for (const row of rows) {
    if (row.status === 'recorded') total += toHalalas(Number(row.amount))
  }
  return total
}

async function applyInvoiceSync(
  ctx: CommandRuntimeContext,
  scope: FreightScope,
  aggregate: AggregateRef,
  paidHalalas: number,
): Promise<SyncOutcome> {
  const paidTotalAmount = halalasToAmountString(paidHalalas)
  const invoice = await readSalesInvoiceReference(ctx, scope, aggregate.salesInvoiceId)
  if (!invoice) {
    return { ok: false, paidTotalAmount, outstandingAmount: null, invoiceNumber: null }
  }
  const totalHalalas = toHalalas(Number(invoice.grandTotalGrossAmount))
  const outstandingAmount = halalasToAmountString(totalHalalas - paidHalalas)
  const ok = await syncSalesInvoiceTotals(ctx, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    invoiceId: aggregate.salesInvoiceId,
    paidTotalAmount,
    outstandingAmount,
  })
  return { ok, paidTotalAmount, outstandingAmount, invoiceNumber: invoice.invoiceNumber }
}

async function persistLedgerSync(
  em: EntityManager,
  scope: FreightScope,
  aggregate: AggregateRef,
  outcome: SyncOutcome,
  paymentId: string | null,
): Promise<void> {
  const now = new Date()
  await em.transactional(async (tx) => {
    if (aggregate.kind === 'abstract' && outcome.ok && outcome.outstandingAmount !== null) {
      const abstract = await tx.findOne(FreightTripAbstract, {
        id: aggregate.abstractId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (abstract) {
        abstract.paidTotalAmount = outcome.paidTotalAmount
        abstract.outstandingAmount = outcome.outstandingAmount
        abstract.updatedAt = now
        await tx.persist(abstract).flush()
      }
    }
    if (paymentId) {
      const payment = await tx.findOne(FreightPayment, {
        id: paymentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (payment) {
        payment.invoiceSyncedAt = outcome.ok ? now : null
        payment.updatedAt = now
        await tx.persist(payment).flush()
      }
    }
  })
}

export type RecordPaymentResult = {
  paymentId: string
  salesPaymentId: string
  paidTotalAmount: string
  outstandingAmount: string | null
  invoiceSynced: boolean
}

const recordPaymentCommand: CommandHandler<RecordPaymentInput, RecordPaymentResult> = {
  id: 'freight_operations.payments.record',
  async execute(rawInput, ctx) {
    const input = recordPaymentSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const receivedAt = toDate(input.receivedAt) ?? new Date()

    const staged = await em.transactional(async (tx) => {
      const aggregate = await loadAggregateForUpdate(ctx, tx, scope, input)
      const currencyCode = input.currencyCode ?? aggregate.currencyCode
      const payment = tx.create(FreightPayment, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId: aggregate.kind === 'order' ? aggregate.orderId : null,
        abstractId: aggregate.kind === 'abstract' ? aggregate.abstractId : null,
        customerId: aggregate.customerId,
        currencyCode,
        amount: String(input.amount),
        method: input.method ?? 'bank_transfer',
        reference: input.reference ?? null,
        receivedAt,
        status: 'recorded',
        notes: input.notes ?? null,
        createdBy: ctx.auth?.sub ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await tx.persist(payment).flush()
      const paidHalalas = await sumRecordedHalalas(tx, scope, aggregate)
      return { payment, aggregate, currencyCode, paidHalalas }
    })

    const bridge = await recordSalesPayment(ctx, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      orderId: staged.aggregate.salesOrderId,
      invoiceId: staged.aggregate.salesInvoiceId,
      amount: String(input.amount),
      currencyCode: staged.currencyCode,
      reference: input.reference ?? null,
      receivedAt,
      metadata: {
        freight: {
          paymentId: staged.payment.id,
          ...(staged.aggregate.kind === 'order'
            ? { orderId: staged.aggregate.orderId }
            : { abstractId: staged.aggregate.abstractId }),
        },
      },
    })

    const outcome = await applyInvoiceSync(ctx, scope, staged.aggregate, staged.paidHalalas)
    await persistLedgerSync(em, scope, staged.aggregate, outcome, staged.payment.id)

    await emitFreightEvent('freight_operations.payment.recorded', {
      id: staged.payment.id,
      customerId: staged.aggregate.customerId,
      amount: String(input.amount),
      currencyCode: staged.currencyCode,
      ...(staged.aggregate.kind === 'order' ? { orderId: staged.aggregate.orderId } : { abstractId: staged.aggregate.abstractId }),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    return {
      paymentId: staged.payment.id,
      salesPaymentId: bridge.salesPaymentId,
      paidTotalAmount: outcome.paidTotalAmount,
      outstandingAmount: outcome.outstandingAmount,
      invoiceSynced: outcome.ok,
    }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record freight payment',
      resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
      resourceId: result.paymentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const voidPaymentCommand: CommandHandler<{ id: string; reason: string }, { paymentId: string; invoiceSynced: boolean }> = {
  id: 'freight_operations.payments.void',
  async execute(rawInput, ctx) {
    const input = voidPaymentSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)

    const staged = await em.transactional(async (tx) => {
      const payment = await tx.findOne(
        FreightPayment,
        { id: input.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!payment) return raiseFreightError(404, 'payment_not_found', 'Freight payment not found.')
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
        resourceId: payment.id,
        current: payment.updatedAt,
        request: ctx.request ?? null,
      })
      if (payment.status !== 'recorded') {
        return raiseFreightError(409, 'payment_already_voided', 'Only recorded payments can be voided.')
      }
      const aggregate = await loadAggregateRef(tx, scope, { orderId: payment.orderId, abstractId: payment.abstractId })
      if (!aggregate) {
        return raiseFreightError(409, 'payment_target_missing', 'The invoiced document for this payment is no longer available.')
      }
      payment.status = 'voided'
      payment.voidedAt = new Date()
      payment.voidedBy = ctx.auth?.sub ?? null
      payment.voidReason = input.reason
      payment.updatedAt = new Date()
      await tx.persist(payment).flush()
      const paidHalalas = await sumRecordedHalalas(tx, scope, aggregate)
      return { payment, aggregate, paidHalalas }
    })

    if (staged.payment.salesPaymentId) {
      await voidSalesPayment(ctx, scope, staged.payment.salesPaymentId)
    }
    const outcome = await applyInvoiceSync(ctx, scope, staged.aggregate, staged.paidHalalas)
    await persistLedgerSync(em, scope, staged.aggregate, outcome, staged.payment.id)

    await emitFreightEvent('freight_operations.payment.voided', {
      id: staged.payment.id,
      customerId: staged.aggregate.customerId,
      reason: input.reason,
      ...(staged.aggregate.kind === 'order' ? { orderId: staged.aggregate.orderId } : { abstractId: staged.aggregate.abstractId }),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    return { paymentId: staged.payment.id, invoiceSynced: outcome.ok }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Void freight payment',
      resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const resyncPaymentCommand: CommandHandler<
  { orderId?: string | null; abstractId?: string | null },
  { paidTotalAmount: string; outstandingAmount: string | null; invoiceSynced: boolean }
> = {
  id: 'freight_operations.payments.resync',
  async execute(rawInput, ctx) {
    const input = paymentSyncSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const aggregate = await loadAggregateRef(em, scope, input)
    if (!aggregate) {
      return raiseFreightError(409, 'payment_target_invoiced_required', 'The document must be invoiced before its ledger can be synced.')
    }
    const paidHalalas = await sumRecordedHalalas(em, scope, aggregate)
    const outcome = await applyInvoiceSync(ctx, scope, aggregate, paidHalalas)
    await persistLedgerSync(em, scope, aggregate, outcome, null)
    return {
      paidTotalAmount: outcome.paidTotalAmount,
      outstandingAmount: outcome.outstandingAmount,
      invoiceSynced: outcome.ok,
    }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Resync freight invoice totals',
      resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
      resourceId: input.orderId ?? input.abstractId ?? '',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(recordPaymentCommand)
registerCommand(voidPaymentCommand)
registerCommand(resyncPaymentCommand)
