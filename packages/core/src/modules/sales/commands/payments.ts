// @ts-nocheck

import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  SalesInvoice,
  SalesOrder,
  SalesOrderLine,
  SalesPayment,
  SalesPaymentAllocation,
  SalesPaymentMethod,
} from '../data/entities'
import {
  paymentCreateSchema,
  paymentUpdateSchema,
  type PaymentCreateInput,
  type PaymentUpdateInput,
} from '../data/validators'
import {
  assertFound,
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  toNumericString,
} from './shared'
import { resolveDictionaryEntryValue } from '../lib/dictionaries'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

export type PaymentAllocationSnapshot = {
  id: string
  orderId: string | null
  invoiceId: string | null
  amount: number
  currencyCode: string
  metadata: Record<string, unknown> | null
}

export type PaymentSnapshot = {
  id: string
  orderId: string | null
  organizationId: string
  tenantId: string
  paymentMethodId: string | null
  paymentReference: string | null
  statusEntryId: string | null
  status: string | null
  amount: number
  currencyCode: string
  capturedAmount: number
  refundedAmount: number
  receivedAt: string | null
  capturedAt: string | null
  metadata: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
  customFieldSetId?: string | null
  allocations: PaymentAllocationSnapshot[]
}

type PaymentUndoPayload = {
  before?: PaymentSnapshot | null
  after?: PaymentSnapshot | null
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const normalizeCustomFieldsInput = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

const ORDER_RESOURCE = 'sales.order'

async function invalidateOrderCache(container: any, order: SalesOrder | null | undefined, tenantId: string | null) {
  if (!order) return
  await invalidateCrudCache(
    container,
    ORDER_RESOURCE,
    { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
    tenantId,
    'updated'
  )
}

export async function loadPaymentSnapshot(em: EntityManager, id: string): Promise<PaymentSnapshot | null> {
  const payment = await em.findOne(
    SalesPayment,
    { id },
    { populate: ['order', 'allocations', 'allocations.order', 'allocations.invoice'] }
  )
  if (!payment) return null
  const allocations: PaymentAllocationSnapshot[] = Array.from(payment.allocations ?? []).map((allocation) => ({
    id: allocation.id,
    orderId:
      typeof allocation.order === 'string'
        ? allocation.order
        : allocation.order?.id ?? (allocation as any).order_id ?? null,
    invoiceId:
      typeof allocation.invoice === 'string'
        ? allocation.invoice
        : allocation.invoice?.id ?? (allocation as any).invoice_id ?? null,
    amount: toNumber(allocation.amount),
    currencyCode: allocation.currencyCode,
    metadata: allocation.metadata ? cloneJson(allocation.metadata) : null,
  }))
  const customFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.sales.sales_payment,
    recordIds: [payment.id],
    tenantIdByRecord: { [payment.id]: payment.tenantId ?? null },
    organizationIdByRecord: { [payment.id]: payment.organizationId ?? null },
  })
  const customFields = customFieldValues[payment.id]
  const normalizedCustomFields =
    customFields && Object.keys(customFields).length ? customFields : null
  return {
    id: payment.id,
    orderId: typeof payment.order === 'string' ? payment.order : payment.order?.id ?? null,
    organizationId: payment.organizationId,
    tenantId: payment.tenantId,
    paymentMethodId:
      typeof payment.paymentMethod === 'string'
        ? payment.paymentMethod
        : payment.paymentMethod?.id ?? null,
    paymentReference: payment.paymentReference ?? null,
    statusEntryId: payment.statusEntryId ?? null,
    status: payment.status ?? null,
    amount: toNumber(payment.amount),
    currencyCode: payment.currencyCode,
    capturedAmount: toNumber(payment.capturedAmount),
    refundedAmount: toNumber(payment.refundedAmount),
    receivedAt: payment.receivedAt ? payment.receivedAt.toISOString() : null,
    capturedAt: payment.capturedAt ? payment.capturedAt.toISOString() : null,
    metadata: payment.metadata ? cloneJson(payment.metadata) : null,
    customFields: normalizedCustomFields,
    customFieldSetId: (payment as any).customFieldSetId ?? (payment as any).custom_field_set_id ?? null,
    allocations,
  }
}

export async function restorePaymentSnapshot(em: EntityManager, snapshot: PaymentSnapshot): Promise<void> {
  const orderRef = snapshot.orderId ? em.getReference(SalesOrder, snapshot.orderId) : null
  const methodRef = snapshot.paymentMethodId
    ? em.getReference(SalesPaymentMethod, snapshot.paymentMethodId)
    : null
  const entity =
    (await em.findOne(SalesPayment, { id: snapshot.id })) ??
    em.create(SalesPayment, {
      id: snapshot.id,
      createdAt: new Date(),
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
    })
  entity.order = orderRef
  entity.paymentMethod = methodRef
  entity.organizationId = snapshot.organizationId
  entity.tenantId = snapshot.tenantId
  entity.paymentReference = snapshot.paymentReference
  entity.statusEntryId = snapshot.statusEntryId
  entity.status = snapshot.status
  entity.amount = toNumericString(snapshot.amount) ?? '0'
  entity.currencyCode = snapshot.currencyCode
  entity.capturedAmount = toNumericString(snapshot.capturedAmount) ?? '0'
  entity.refundedAmount = toNumericString(snapshot.refundedAmount) ?? '0'
  entity.receivedAt = snapshot.receivedAt ? new Date(snapshot.receivedAt) : null
  entity.capturedAt = snapshot.capturedAt ? new Date(snapshot.capturedAt) : null
  entity.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  entity.customFieldSetId =
    (snapshot as any).customFieldSetId ?? (snapshot as any).custom_field_set_id ?? null
  entity.updatedAt = new Date()

  if ((snapshot as any).customFields !== undefined) {
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_payment,
      recordId: entity.id,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
      values:
        snapshot.customFields && typeof snapshot.customFields === 'object'
          ? (snapshot.customFields as Record<string, unknown>)
          : {},
    })
  }

  const existingAllocations = await em.find(SalesPaymentAllocation, { payment: entity })
  existingAllocations.forEach((allocation) => em.remove(allocation))
  snapshot.allocations.forEach((allocation) => {
    const order =
      allocation.orderId && typeof allocation.orderId === 'string'
        ? em.getReference(SalesOrder, allocation.orderId)
        : null
    const invoice =
      allocation.invoiceId && typeof allocation.invoiceId === 'string'
        ? em.getReference(SalesInvoice, allocation.invoiceId)
        : null
    const newAllocation = em.create(SalesPaymentAllocation, {
      payment: entity,
      order,
      invoice,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      amount: toNumericString(allocation.amount) ?? '0',
      currencyCode: allocation.currencyCode,
      metadata: allocation.metadata ? cloneJson(allocation.metadata) : null,
    })
    em.persist(newAllocation)
  })
  em.persist(entity)
}

async function recomputeOrderPaymentTotals(
  em: EntityManager,
  order: SalesOrder
): Promise<{ paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number }> {
  const orderId = order.id
  const scope = { organizationId: order.organizationId, tenantId: order.tenantId }

  const allocations = await em.find(
    SalesPaymentAllocation,
    { ...scope, order: orderId },
    { populate: ['payment'] }
  )

  const paymentIds = new Set<string>()
  allocations.forEach((allocation) => {
    const paymentRef = allocation.payment
    const paymentId =
      typeof paymentRef === 'object' && paymentRef !== null
        ? paymentRef.id
        : typeof paymentRef === 'string'
          ? paymentRef
          : null
    if (paymentId) paymentIds.add(paymentId)
  })

  const payments =
    paymentIds.size > 0
      ? await em.find(SalesPayment, { id: { $in: Array.from(paymentIds) }, deletedAt: null, ...scope })
      : await em.find(SalesPayment, { order: orderId, deletedAt: null, ...scope })

  const resolvePaidAmount = (payment: SalesPayment) => {
    const captured = toNumber(payment.capturedAmount)
    return captured > 0 ? captured : toNumber(payment.amount)
  }

  const activePaymentIds = new Set(payments.map((payment) => payment.id))
  const paidTotal =
    allocations.length > 0
      ? allocations.reduce((sum, allocation) => {
          const paymentRef = allocation.payment
          const paymentId =
            typeof paymentRef === 'object' && paymentRef !== null
              ? paymentRef.id
              : typeof paymentRef === 'string'
                ? paymentRef
                : null
          if (paymentId && !activePaymentIds.has(paymentId)) return sum
          return sum + toNumber(allocation.amount)
        }, 0)
      : payments.reduce((sum, payment) => sum + resolvePaidAmount(payment), 0)

  const refundedTotal = payments.reduce(
    (sum, payment) => sum + toNumber(payment.refundedAmount),
    0
  )

  const grandTotal = toNumber(order.grandTotalGrossAmount)
  const outstanding = Math.max(grandTotal - paidTotal + refundedTotal, 0)
  order.paidTotalAmount = toNumericString(paidTotal) ?? '0'
  order.refundedTotalAmount = toNumericString(refundedTotal) ?? '0'
  order.outstandingAmount = toNumericString(outstanding) ?? '0'
  return {
    paidTotalAmount: paidTotal,
    refundedTotalAmount: refundedTotal,
    outstandingAmount: outstanding,
  }
}

const createPaymentCommand: CommandHandler<
  PaymentCreateInput,
  { paymentId: string; orderTotals?: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } }
> = {
  id: 'sales.payments.create',
  async execute(rawInput, ctx) {
    const input = paymentCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const { translate } = await resolveTranslations()
    if (!input.orderId) {
      throw new CrudHttpError(400, { error: translate('sales.payments.order_required', 'Order is required for payments.') })
    }
    const order = assertFound(
      await em.findOne(SalesOrder, { id: input.orderId }),
      'sales.payments.order_not_found'
    )
    ensureSameScope(order, input.organizationId, input.tenantId)
    if (order.deletedAt) {
      throw new CrudHttpError(404, { error: 'sales.payments.order_not_found' })
    }
    if (
      order.currencyCode &&
      input.currencyCode &&
      order.currencyCode.toUpperCase() !== input.currencyCode.toUpperCase()
    ) {
      throw new CrudHttpError(400, {
        error: translate('sales.payments.currency_mismatch', 'Payment currency must match the order currency.'),
      })
    }
    let paymentMethod = null
    if (input.paymentMethodId) {
      const method = assertFound(
        await em.findOne(SalesPaymentMethod, { id: input.paymentMethodId }),
        'sales.payments.method_not_found'
      )
      ensureSameScope(method, input.organizationId, input.tenantId)
      paymentMethod = method
    }
    if (input.documentStatusEntryId !== undefined) {
      const orderStatus = await resolveDictionaryEntryValue(em, input.documentStatusEntryId ?? null)
      if (input.documentStatusEntryId && !orderStatus) {
        throw new CrudHttpError(400, {
          error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
        })
      }
      order.statusEntryId = input.documentStatusEntryId ?? null
      order.status = orderStatus
      order.updatedAt = new Date()
      em.persist(order)
    }
    if (input.lineStatusEntryId !== undefined) {
      const lineStatus = await resolveDictionaryEntryValue(em, input.lineStatusEntryId ?? null)
      if (input.lineStatusEntryId && !lineStatus) {
        throw new CrudHttpError(400, {
          error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
        })
      }
      const orderLines = await em.find(SalesOrderLine, { order })
      orderLines.forEach((line) => {
        line.statusEntryId = input.lineStatusEntryId ?? null
        line.status = lineStatus
        line.updatedAt = new Date()
      })
      orderLines.forEach((line) => em.persist(line))
    }
    const status = await resolveDictionaryEntryValue(em, input.statusEntryId ?? null)
    const payment = em.create(SalesPayment, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      order,
      paymentMethod,
      paymentReference: input.paymentReference ?? null,
      statusEntryId: input.statusEntryId ?? null,
      status,
      amount: toNumericString(input.amount) ?? '0',
      currencyCode: input.currencyCode,
      capturedAmount: toNumericString(input.capturedAmount) ?? '0',
      refundedAmount: toNumericString(input.refundedAmount) ?? '0',
      receivedAt: input.receivedAt ?? null,
      capturedAt: input.capturedAt ?? null,
      metadata: input.metadata ? cloneJson(input.metadata) : null,
      customFieldSetId: input.customFieldSetId ?? null,
    })
    const allocationInputs = Array.isArray(input.allocations) ? input.allocations : []
    const allocations = allocationInputs.length
      ? allocationInputs
      : [
          {
            orderId: input.orderId,
            invoiceId: null,
            amount: input.amount,
            currencyCode: input.currencyCode,
            metadata: null,
          },
        ]
    allocations.forEach((allocation) => {
      const orderRef = allocation.orderId ? em.getReference(SalesOrder, allocation.orderId) : order
      const invoiceRef = allocation.invoiceId ? em.getReference(SalesInvoice, allocation.invoiceId) : null
      const entity = em.create(SalesPaymentAllocation, {
        payment,
        order: orderRef,
        invoice: invoiceRef,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        amount: toNumericString(allocation.amount) ?? '0',
        currencyCode: allocation.currencyCode,
        metadata: allocation.metadata ? cloneJson(allocation.metadata) : null,
      })
      em.persist(entity)
    })
    em.persist(payment)
    if (input.customFields !== undefined) {
      if (!payment.id) {
        await em.flush()
      }
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_payment,
        recordId: payment.id,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        values: normalizeCustomFieldsInput(input.customFields),
      })
    }
    await em.flush()
    const totals = await recomputeOrderPaymentTotals(em, order)
    await em.flush()
    await invalidateOrderCache(ctx.container, order, ctx.auth?.tenantId ?? null)
    return { paymentId: payment.id, orderTotals: totals }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return result?.paymentId ? loadPaymentSnapshot(em, result.paymentId) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as PaymentSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.payments.create', 'Create payment'),
      resourceKind: 'sales.payment',
      resourceId: result.paymentId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies PaymentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PaymentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const existing = await em.findOne(SalesPayment, { id: after.id })
    if (existing) {
      const orderRef =
        typeof existing.order === 'string' ? existing.order : existing.order?.id ?? null
      const allocations = await em.find(SalesPaymentAllocation, { payment: existing })
      const allocationOrders = allocations
        .map((allocation) =>
          typeof allocation.order === 'string'
            ? allocation.order
            : allocation.order?.id ?? null
        )
        .filter((value): value is string => typeof value === 'string' && value.length > 0)

      allocations.forEach((allocation) => em.remove(allocation))
      await em.flush()

      em.remove(existing)
      await em.flush()

      const orderIds = Array.from(
        new Set(
          [
            orderRef,
            ...allocationOrders,
          ].filter((value): value is string => typeof value === 'string' && value.length > 0)
        )
      )
      for (const id of orderIds) {
        const order = await em.findOne(SalesOrder, { id })
        if (!order) continue
        await recomputeOrderPaymentTotals(em, order)
        await em.flush()
      }
    }
  },
}

const updatePaymentCommand: CommandHandler<
  PaymentUpdateInput,
  { paymentId: string; orderTotals?: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } }
> = {
  id: 'sales.payments.update',
  async prepare(rawInput, ctx) {
    const parsed = paymentUpdateSchema.parse(rawInput ?? {})
    if (!parsed.id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadPaymentSnapshot(em, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = paymentUpdateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const { translate } = await resolveTranslations()
    const payment = assertFound(
      await em.findOne(SalesPayment, { id: input.id }, { populate: ['order'] }),
      'sales.payments.not_found'
    )
    ensureSameScope(payment, input.organizationId, input.tenantId)
    const previousOrder = payment.order as SalesOrder | null
    if (input.orderId !== undefined) {
      if (!input.orderId) {
        payment.order = null
      } else {
        const order = assertFound(
          await em.findOne(SalesOrder, { id: input.orderId }),
          'sales.payments.order_not_found'
        )
        ensureSameScope(order, input.organizationId, input.tenantId)
        if (
          order.currencyCode &&
          input.currencyCode &&
          order.currencyCode.toUpperCase() !== input.currencyCode.toUpperCase()
        ) {
          throw new CrudHttpError(400, {
            error: translate('sales.payments.currency_mismatch', 'Payment currency must match the order currency.'),
          })
        }
        payment.order = order
      }
    }
    if (input.paymentMethodId !== undefined) {
      if (!input.paymentMethodId) {
        payment.paymentMethod = null
      } else {
        const method = assertFound(
          await em.findOne(SalesPaymentMethod, { id: input.paymentMethodId }),
          'sales.payments.method_not_found'
        )
        ensureSameScope(method, input.organizationId, input.tenantId)
        payment.paymentMethod = method
      }
    }
    const currentOrder = payment.order as SalesOrder | null
    if ((input.documentStatusEntryId !== undefined || input.lineStatusEntryId !== undefined) && !currentOrder) {
      throw new CrudHttpError(400, { error: translate('sales.payments.order_required', 'Order is required for payments.') })
    }
    if (currentOrder && input.documentStatusEntryId !== undefined) {
      const orderStatus = await resolveDictionaryEntryValue(em, input.documentStatusEntryId ?? null)
      if (input.documentStatusEntryId && !orderStatus) {
        throw new CrudHttpError(400, {
          error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
        })
      }
      currentOrder.statusEntryId = input.documentStatusEntryId ?? null
      currentOrder.status = orderStatus
      currentOrder.updatedAt = new Date()
      em.persist(currentOrder)
    }
    if (currentOrder && input.lineStatusEntryId !== undefined) {
      const lineStatus = await resolveDictionaryEntryValue(em, input.lineStatusEntryId ?? null)
      if (input.lineStatusEntryId && !lineStatus) {
        throw new CrudHttpError(400, {
          error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
        })
      }
      const orderLines = await em.find(SalesOrderLine, { order: currentOrder })
      orderLines.forEach((line) => {
        line.statusEntryId = input.lineStatusEntryId ?? null
        line.status = lineStatus
        line.updatedAt = new Date()
      })
      orderLines.forEach((line) => em.persist(line))
    }
    if (input.paymentReference !== undefined) payment.paymentReference = input.paymentReference ?? null
    if (input.statusEntryId !== undefined) {
      payment.statusEntryId = input.statusEntryId ?? null
      payment.status = await resolveDictionaryEntryValue(em, input.statusEntryId ?? null)
    }
    if (input.amount !== undefined) payment.amount = toNumericString(input.amount) ?? '0'
    if (input.currencyCode !== undefined) payment.currencyCode = input.currencyCode
    if (input.capturedAmount !== undefined) {
      payment.capturedAmount = toNumericString(input.capturedAmount) ?? '0'
    }
    if (input.refundedAmount !== undefined) {
      payment.refundedAmount = toNumericString(input.refundedAmount) ?? '0'
    }
    if (input.receivedAt !== undefined) payment.receivedAt = input.receivedAt ?? null
    if (input.capturedAt !== undefined) payment.capturedAt = input.capturedAt ?? null
    if (input.metadata !== undefined) {
      payment.metadata = input.metadata ? cloneJson(input.metadata) : null
    }
    if (input.customFieldSetId !== undefined) {
      payment.customFieldSetId = input.customFieldSetId ?? null
    }
    if (input.customFields !== undefined) {
      if (!payment.id) {
        await em.flush()
      }
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_payment,
        recordId: payment.id,
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
        values: normalizeCustomFieldsInput(input.customFields),
      })
    }
    if (input.allocations !== undefined) {
      const existingAllocations = await em.find(SalesPaymentAllocation, { payment })
      existingAllocations.forEach((allocation) => em.remove(allocation))
      const allocationInputs = Array.isArray(input.allocations) ? input.allocations : []
      allocationInputs.forEach((allocation) => {
        const orderRef =
          allocation.orderId ??
          (typeof payment.order === 'string' ? payment.order : payment.order?.id) ??
          null
        const order =
          orderRef && typeof orderRef === 'string' ? em.getReference(SalesOrder, orderRef) : null
        const invoice = allocation.invoiceId
          ? em.getReference(SalesInvoice, allocation.invoiceId)
          : null
        const entity = em.create(SalesPaymentAllocation, {
          payment,
          order,
          invoice,
          organizationId: payment.organizationId,
          tenantId: payment.tenantId,
          amount: toNumericString(allocation.amount) ?? '0',
          currencyCode: allocation.currencyCode,
          metadata: allocation.metadata ? cloneJson(allocation.metadata) : null,
        })
        em.persist(entity)
      })
    }
    payment.updatedAt = new Date()
    await em.flush()

    const nextOrder =
      (payment.order as SalesOrder | null) ??
      (typeof payment.order === 'string'
        ? await em.findOne(SalesOrder, { id: payment.order })
        : null)
    let totals: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } | undefined
    if (nextOrder) {
      totals = await recomputeOrderPaymentTotals(em, nextOrder)
      await em.flush()
      await invalidateOrderCache(ctx.container, nextOrder, ctx.auth?.tenantId ?? null)
    }
    if (previousOrder && (!nextOrder || previousOrder.id !== nextOrder.id)) {
      await recomputeOrderPaymentTotals(em, previousOrder)
      await em.flush()
      await invalidateOrderCache(ctx.container, previousOrder, ctx.auth?.tenantId ?? null)
    }

    return { paymentId: payment.id, orderTotals: totals }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return result?.paymentId ? loadPaymentSnapshot(em, result.paymentId) : null
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PaymentSnapshot | undefined
    const after = snapshots.after as PaymentSnapshot | undefined
    return {
      actionLabel: translate('sales.audit.payments.update', 'Update payment'),
      resourceKind: 'sales.payment',
      resourceId: result.paymentId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after } satisfies PaymentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PaymentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    await restorePaymentSnapshot(em, before)
    await em.flush()
    if (before.orderId) {
      const order = await em.findOne(SalesOrder, { id: before.orderId })
      if (order) {
        await recomputeOrderPaymentTotals(em, order)
        await em.flush()
      }
    }
  },
}

const deletePaymentCommand: CommandHandler<
  { id: string; orderId?: string | null; organizationId: string; tenantId: string },
  { paymentId: string; orderTotals?: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } }
> = {
  id: 'sales.payments.delete',
  async prepare(rawInput, ctx) {
    const parsed = paymentUpdateSchema.parse(rawInput ?? {})
    if (!parsed.id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadPaymentSnapshot(em, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = paymentUpdateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const payment = assertFound(
      await em.findOne(SalesPayment, { id: input.id }, { populate: ['order'] }),
      'sales.payments.not_found'
    )
    ensureSameScope(payment, input.organizationId, input.tenantId)
    const order = payment.order as SalesOrder | null
    const allocations = await em.find(SalesPaymentAllocation, { payment })
    const allocationOrders = allocations
      .map((allocation) =>
        typeof allocation.order === 'string'
          ? allocation.order
          : allocation.order?.id ?? null
      )
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    allocations.forEach((allocation) => em.remove(allocation))
    await em.flush()
    em.remove(payment)
    await em.flush()
    let totals: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } | undefined
    const orderIds = Array.from(
      new Set(
        [
          order && typeof order === 'object' ? order.id : null,
          ...allocationOrders,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    )
    const primaryOrderId = order && typeof order === 'object' ? order.id : null
    for (const orderId of orderIds) {
      const target = typeof order === 'object' && order.id === orderId ? order : await em.findOne(SalesOrder, { id: orderId })
      if (!target) continue
      const recomputed = await recomputeOrderPaymentTotals(em, target)
      if (!totals || (primaryOrderId && orderId === primaryOrderId)) {
        totals = recomputed
      }
      await em.flush()
      await invalidateOrderCache(ctx.container, target, ctx.auth?.tenantId ?? null)
    }
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (allocations.length) {
      await Promise.all(
        allocations.map((allocation) =>
          emitCrudSideEffects({
            dataEngine,
            action: 'deleted',
            entity: allocation,
            identifiers: {
              id: allocation.id,
              organizationId: allocation.organizationId ?? null,
              tenantId: allocation.tenantId ?? null,
            },
            indexer: { entityType: E.sales.sales_payment_allocation },
          })
        )
      )
    }
    return { paymentId: payment.id, orderTotals: totals }
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PaymentSnapshot | undefined
    return {
      actionLabel: translate('sales.audit.payments.delete', 'Delete payment'),
      resourceKind: 'sales.payment',
      resourceId: result.paymentId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before } satisfies PaymentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PaymentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    await restorePaymentSnapshot(em, before)
    await em.flush()
    if (before.orderId) {
      const order = await em.findOne(SalesOrder, { id: before.orderId })
      if (order) {
        await recomputeOrderPaymentTotals(em, order)
        await em.flush()
      }
    }
  },
}

export const paymentCommands = [createPaymentCommand, updatePaymentCommand, deletePaymentCommand]

registerCommand(createPaymentCommand)
registerCommand(updatePaymentCommand)
registerCommand(deletePaymentCommand)
