// @ts-nocheck

import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { E } from '#generated/entities.ids.generated'
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
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

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
  orderPaymentMethodIdBefore?: string | null
  orderPaymentMethodCodeBefore?: string | null
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

const paymentCrudEvents: CrudEventsConfig = {
  module: 'sales',
  entity: 'payment',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

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

export async function loadPaymentSnapshot(em: EntityManager, id: string, scope?: { tenantId?: string | null; organizationId?: string | null }): Promise<PaymentSnapshot | null> {
  const payment = await findOneWithDecryption(
    em,
    SalesPayment,
    { id },
    { populate: ['order', 'allocations', 'allocations.order', 'allocations.invoice'] },
    scope,
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
    (await findOneWithDecryption(em, SalesPayment, { id: snapshot.id }, {}, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId })) ??
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
  await em.flush()

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

  const existingAllocations = await findWithDecryption(em, SalesPaymentAllocation, { payment: entity }, {}, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId })
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
  order: SalesOrder,
  options?: { lock?: boolean }
): Promise<{ paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number }> {
  const orderId = order.id
  const scope = { organizationId: order.organizationId, tenantId: order.tenantId }

  if (options?.lock) {
    await findOneWithDecryption(em, SalesOrder, { id: orderId, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
  }

  const allocations = await findWithDecryption(
    em,
    SalesPaymentAllocation,
    { ...scope, order: orderId },
    { populate: ['payment'] },
    scope,
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
      ? await findWithDecryption(em, SalesPayment, { id: { $in: Array.from(paymentIds) }, deletedAt: null, ...scope }, {}, scope)
      : await findWithDecryption(em, SalesPayment, { order: orderId, deletedAt: null, ...scope }, {}, scope)

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
  { paymentId: string; orderTotals?: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number }; orderPaymentMethodIdBefore?: string | null; orderPaymentMethodCodeBefore?: string | null }
> = {
  id: 'sales.payments.create',
  async execute(rawInput, ctx) {
    const input = paymentCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { translate } = await resolveTranslations()
    if (!input.orderId) {
      throw new CrudHttpError(400, { error: translate('sales.payments.order_required', 'Order is required for payments.') })
    }

    const { payment, order, totals, orderPaymentMethodIdBefore, orderPaymentMethodCodeBefore } = await em.transactional(async (tx) => {
      const order = assertFound(
        await findOneWithDecryption(tx, SalesOrder, { id: input.orderId }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: input.tenantId, organizationId: input.organizationId }),
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
          await findOneWithDecryption(tx, SalesPaymentMethod, { id: input.paymentMethodId }, {}, { tenantId: input.tenantId, organizationId: input.organizationId }),
          'sales.payments.method_not_found'
        )
        ensureSameScope(method, input.organizationId, input.tenantId)
        paymentMethod = method
      }
      const orderPaymentMethodIdBefore = order.paymentMethodId ?? null
      const orderPaymentMethodCodeBefore = order.paymentMethodCode ?? null
      if (paymentMethod && !order.paymentMethodId) {
        order.paymentMethodId = paymentMethod.id
        order.paymentMethodCode = paymentMethod.code ?? null
        order.updatedAt = new Date()
        tx.persist(order)
      }
      if (input.documentStatusEntryId !== undefined) {
        const orderStatus = await resolveDictionaryEntryValue(tx, input.documentStatusEntryId ?? null, { tenantId: input.tenantId })
        if (input.documentStatusEntryId && !orderStatus) {
          throw new CrudHttpError(400, {
            error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
          })
        }
        order.statusEntryId = input.documentStatusEntryId ?? null
        order.status = orderStatus
        order.updatedAt = new Date()
        tx.persist(order)
      }
      if (input.lineStatusEntryId !== undefined) {
        const lineStatus = await resolveDictionaryEntryValue(tx, input.lineStatusEntryId ?? null, { tenantId: input.tenantId })
        if (input.lineStatusEntryId && !lineStatus) {
          throw new CrudHttpError(400, {
            error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
          })
        }
        const orderLines = await findWithDecryption(tx, SalesOrderLine, { order }, {}, { tenantId: input.tenantId, organizationId: input.organizationId })
        orderLines.forEach((line) => {
          line.statusEntryId = input.lineStatusEntryId ?? null
          line.status = lineStatus
          line.updatedAt = new Date()
        })
        orderLines.forEach((line) => tx.persist(line))
      }
      const status = await resolveDictionaryEntryValue(tx, input.statusEntryId ?? null, { tenantId: input.tenantId })
      const payment = tx.create(SalesPayment, {
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
      const orderCache = new Map<string, SalesOrder>([[order.id, order]])
      const invoiceCache = new Map<string, SalesInvoice>()
      for (const allocation of allocations) {
        let allocationOrder: SalesOrder | null = null
        if (allocation.orderId) {
          allocationOrder = orderCache.get(allocation.orderId) ?? null
          if (!allocationOrder) {
            allocationOrder = assertFound(
              await findOneWithDecryption(
                tx,
                SalesOrder,
                { id: allocation.orderId },
                {},
                { tenantId: input.tenantId, organizationId: input.organizationId },
              ),
              'sales.payments.order_not_found',
            )
            ensureSameScope(allocationOrder, input.organizationId, input.tenantId)
            orderCache.set(allocation.orderId, allocationOrder)
          }
        }
        let allocationInvoice: SalesInvoice | null = null
        if (allocation.invoiceId) {
          allocationInvoice = invoiceCache.get(allocation.invoiceId) ?? null
          if (!allocationInvoice) {
            allocationInvoice = assertFound(
              await findOneWithDecryption(
                tx,
                SalesInvoice,
                { id: allocation.invoiceId },
                {},
                { tenantId: input.tenantId, organizationId: input.organizationId },
              ),
              'sales.payments.invoice_not_found',
            )
            ensureSameScope(allocationInvoice, input.organizationId, input.tenantId)
            invoiceCache.set(allocation.invoiceId, allocationInvoice)
          }
        }
        const entity = tx.create(SalesPaymentAllocation, {
          payment,
          order: allocationOrder,
          invoice: allocationInvoice,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          amount: toNumericString(allocation.amount) ?? '0',
          currencyCode: allocation.currencyCode,
          metadata: allocation.metadata ? cloneJson(allocation.metadata) : null,
        })
        tx.persist(entity)
      }
      tx.persist(payment)
      if (input.customFields !== undefined) {
        if (!payment.id) {
          await tx.flush()
        }
        await setRecordCustomFields(tx, {
          entityId: E.sales.sales_payment,
          recordId: payment.id,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          values: normalizeCustomFieldsInput(input.customFields),
        })
      }
      await tx.flush()
      const totals = await recomputeOrderPaymentTotals(tx, order)
      await tx.flush()
      return { payment, order, totals, orderPaymentMethodIdBefore, orderPaymentMethodCodeBefore }
    })

    await invalidateOrderCache(ctx.container, order, ctx.auth?.tenantId ?? null)

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: payment,
      identifiers: {
        id: payment.id,
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
      },
      indexer: { entityType: E.sales.sales_payment },
      events: paymentCrudEvents,
    })

    // Create notification for payment received
    try {
      const notificationService = resolveNotificationService(ctx.container)
      const typeDef = notificationTypes.find((type) => type.type === 'sales.payment.received')
      if (typeDef) {
        const amountDisplay = payment.amount && payment.currencyCode
          ? `${payment.currencyCode} ${payment.amount}`
          : ''
        const notificationInput = buildFeatureNotificationFromType(typeDef, {
          requiredFeature: 'sales.orders.manage',
          bodyVariables: {
            orderNumber: order.orderNumber ?? '',
            amount: amountDisplay,
          },
          sourceEntityType: 'sales:order',
          sourceEntityId: order.id,
          linkHref: `/backend/sales/orders/${order.id}`,
        })

        await notificationService.createForFeature(notificationInput, {
          tenantId: payment.tenantId,
          organizationId: payment.organizationId ?? null,
        })
      }
    } catch (err) {
      // Notification creation is non-critical, don't fail the command
      console.error('[sales.payments.create] Failed to create notification:', err)
    }

    return { paymentId: payment.id, orderTotals: totals, orderPaymentMethodIdBefore, orderPaymentMethodCodeBefore }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = ctx.auth?.tenantId ? { tenantId: ctx.auth.tenantId, organizationId: ctx.auth?.orgId ?? null } : undefined
    return result?.paymentId ? loadPaymentSnapshot(em, result.paymentId, scope) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as PaymentSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.payments.create', 'Create payment'),
      resourceKind: 'sales.payment',
      resourceId: result.paymentId,
      parentResourceKind: 'sales.order',
      parentResourceId: after.orderId ?? null,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after, orderPaymentMethodIdBefore: result.orderPaymentMethodIdBefore ?? null, orderPaymentMethodCodeBefore: result.orderPaymentMethodCodeBefore ?? null } satisfies PaymentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PaymentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await findOneWithDecryption(em, SalesPayment, { id: after.id }, {}, { tenantId: after.tenantId, organizationId: after.organizationId })
    if (existing) {
      const orderRef =
        typeof existing.order === 'string' ? existing.order : existing.order?.id ?? null
      const allocations = await findWithDecryption(em, SalesPaymentAllocation, { payment: existing }, {}, { tenantId: after.tenantId, organizationId: after.organizationId })
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
        await em.transactional(async (tx) => {
          const order = await findOneWithDecryption(tx, SalesOrder, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: after.tenantId, organizationId: after.organizationId })
          if (!order) return
          if (id === after.orderId && 'orderPaymentMethodIdBefore' in (payload ?? {})) {
            order.paymentMethodId = payload.orderPaymentMethodIdBefore ?? null
            order.paymentMethodCode = payload.orderPaymentMethodCodeBefore ?? null
            order.updatedAt = new Date()
            await tx.flush()
          }
          await recomputeOrderPaymentTotals(tx, order)
          await tx.flush()
        })
      }
    }
  },
  redo: async ({ ctx, logEntry }) => {
    const after = resolveRedoSnapshot<PaymentSnapshot>(logEntry)
    const paymentId = after?.id ?? logEntry.resourceId ?? null
    if (!after || !paymentId) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for sales.payments.create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restorePaymentSnapshot(em, after)
    await em.flush()

    const orderIds = Array.from(
      new Set(
        [
          after.orderId,
          ...after.allocations.map((allocation) => allocation.orderId),
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    )
    let totals: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } | undefined
    for (const orderId of orderIds) {
      const recomputed = await em.transactional(async (tx) => {
        const order = await findOneWithDecryption(
          tx,
          SalesOrder,
          { id: orderId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          { tenantId: after.tenantId, organizationId: after.organizationId },
        )
        if (!order) return undefined
        if (orderId === after.orderId && after.paymentMethodId && !order.paymentMethodId) {
          const method = await findOneWithDecryption(
            tx,
            SalesPaymentMethod,
            { id: after.paymentMethodId },
            {},
            { tenantId: after.tenantId, organizationId: after.organizationId },
          )
          order.paymentMethodId = method?.id ?? after.paymentMethodId
          order.paymentMethodCode = method?.code ?? null
          order.updatedAt = new Date()
          await tx.flush()
        }
        const result = await recomputeOrderPaymentTotals(tx, order)
        await tx.flush()
        return result
      })
      if (recomputed && (!totals || orderId === after.orderId)) {
        totals = recomputed
      }
      // Scope filter (#2111): never cache-invalidate a foreign tenant's order even
      // if a snapshot's orderId was somehow tampered with.
      const target = await findOneWithDecryption(em, SalesOrder, { id: orderId, organizationId: after.organizationId, tenantId: after.tenantId }, {}, { tenantId: after.tenantId, organizationId: after.organizationId })
      if (target) {
        ensureSameScope(target, after.organizationId, after.tenantId)
        await invalidateOrderCache(ctx.container, target, ctx.auth?.tenantId ?? null)
      }
    }

    const payment = await findOneWithDecryption(em, SalesPayment, { id: after.id }, {}, { tenantId: after.tenantId, organizationId: after.organizationId })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: payment,
      identifiers: {
        id: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
      },
      indexer: { entityType: E.sales.sales_payment },
      events: paymentCrudEvents,
    })

    return { paymentId: after.id, orderTotals: totals }
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
    const scope = ctx.auth?.tenantId ? { tenantId: ctx.auth.tenantId, organizationId: ctx.auth?.orgId ?? null } : undefined
    const snapshot = await loadPaymentSnapshot(em, parsed.id, scope)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = paymentUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { translate } = await resolveTranslations()
    const scopeSeed = assertFound(
      await findOneWithDecryption(em, SalesPayment, { id: input.id }, {}, { tenantId: input.tenantId, organizationId: input.organizationId }),
      'sales.payments.not_found'
    )
    const resolvedTenantId = input.tenantId ?? scopeSeed.tenantId
    const resolvedOrganizationId = input.organizationId ?? scopeSeed.organizationId
    ensureTenantScope(ctx, resolvedTenantId)
    ensureOrganizationScope(ctx, resolvedOrganizationId)
    const payment = assertFound(
      await findOneWithDecryption(
        em,
        SalesPayment,
        { id: input.id },
        { populate: ['order'] },
        { tenantId: resolvedTenantId, organizationId: resolvedOrganizationId },
      ),
      'sales.payments.not_found'
    )
    ensureSameScope(payment, resolvedOrganizationId, resolvedTenantId)
    const previousOrder = payment.order as SalesOrder | null
    // Apply payment scalar fields, order/line status changes and the
    // allocations rebuild in one transaction so a mid-write failure cannot
    // leave the payment and its allocations partially committed (#2336).
    await em.transactional(async (tx) => {
      if (input.orderId !== undefined) {
        if (!input.orderId) {
          payment.order = null
        } else {
          const order = assertFound(
            await findOneWithDecryption(tx, SalesOrder, { id: input.orderId }, {}, { tenantId: resolvedTenantId, organizationId: resolvedOrganizationId }),
            'sales.payments.order_not_found'
          )
          ensureSameScope(order, resolvedOrganizationId, resolvedTenantId)
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
            await findOneWithDecryption(tx, SalesPaymentMethod, { id: input.paymentMethodId }, {}, { tenantId: resolvedTenantId, organizationId: resolvedOrganizationId }),
            'sales.payments.method_not_found'
          )
          ensureSameScope(method, resolvedOrganizationId, resolvedTenantId)
          payment.paymentMethod = method
        }
      }
      const currentOrder = payment.order as SalesOrder | null
      if ((input.documentStatusEntryId !== undefined || input.lineStatusEntryId !== undefined) && !currentOrder) {
        throw new CrudHttpError(400, { error: translate('sales.payments.order_required', 'Order is required for payments.') })
      }
      if (currentOrder && input.documentStatusEntryId !== undefined) {
        const orderStatus = await resolveDictionaryEntryValue(tx, input.documentStatusEntryId ?? null, { tenantId: resolvedTenantId })
        if (input.documentStatusEntryId && !orderStatus) {
          throw new CrudHttpError(400, {
            error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
          })
        }
        currentOrder.statusEntryId = input.documentStatusEntryId ?? null
        currentOrder.status = orderStatus
        currentOrder.updatedAt = new Date()
        tx.persist(currentOrder)
      }
      if (currentOrder && input.lineStatusEntryId !== undefined) {
        const lineStatus = await resolveDictionaryEntryValue(tx, input.lineStatusEntryId ?? null, { tenantId: resolvedTenantId })
        if (input.lineStatusEntryId && !lineStatus) {
          throw new CrudHttpError(400, {
            error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.'),
          })
        }
        const orderLines = await findWithDecryption(tx, SalesOrderLine, { order: currentOrder }, {}, { tenantId: resolvedTenantId, organizationId: resolvedOrganizationId })
        orderLines.forEach((line) => {
          line.statusEntryId = input.lineStatusEntryId ?? null
          line.status = lineStatus
          line.updatedAt = new Date()
        })
        orderLines.forEach((line) => tx.persist(line))
      }
      if (input.paymentReference !== undefined) payment.paymentReference = input.paymentReference ?? null
      if (input.statusEntryId !== undefined) {
        payment.statusEntryId = input.statusEntryId ?? null
        payment.status = await resolveDictionaryEntryValue(tx, input.statusEntryId ?? null, { tenantId: resolvedTenantId })
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
          await tx.flush()
        }
        await setRecordCustomFields(tx, {
          entityId: E.sales.sales_payment,
          recordId: payment.id,
          organizationId: payment.organizationId,
          tenantId: payment.tenantId,
          values: normalizeCustomFieldsInput(input.customFields),
        })
      }
      payment.updatedAt = new Date()

      // Persist the payment scalar changes before any allocation query below.
      // MikroORM discards pending scalar mutations when a find() runs on the
      // same EntityManager before they are flushed, which would otherwise drop
      // the updated amount/reference when allocations are (re)synced.
      await tx.flush()

      if (input.allocations !== undefined) {
        const existingAllocations = await findWithDecryption(tx, SalesPaymentAllocation, { payment }, {}, { tenantId: payment.tenantId, organizationId: payment.organizationId })
        existingAllocations.forEach((allocation) => tx.remove(allocation))
        const allocationInputs = Array.isArray(input.allocations) ? input.allocations : []
        const paymentOrderId =
          (typeof payment.order === 'string' ? payment.order : payment.order?.id) ?? null
        const orderCache = new Map<string, SalesOrder>()
        if (currentOrder) orderCache.set(currentOrder.id, currentOrder)
        const invoiceCache = new Map<string, SalesInvoice>()
        for (const allocation of allocationInputs) {
          const orderId = allocation.orderId ?? paymentOrderId
          let order: SalesOrder | null = null
          if (orderId && typeof orderId === 'string') {
            order = orderCache.get(orderId) ?? null
            if (!order) {
              order = assertFound(
                await findOneWithDecryption(
                  tx,
                  SalesOrder,
                  { id: orderId },
                  {},
                  { tenantId: payment.tenantId, organizationId: payment.organizationId },
                ),
                'sales.payments.order_not_found',
              )
              ensureSameScope(order, payment.organizationId, payment.tenantId)
              orderCache.set(orderId, order)
            }
          }
          let invoice: SalesInvoice | null = null
          if (allocation.invoiceId) {
            invoice = invoiceCache.get(allocation.invoiceId) ?? null
            if (!invoice) {
              invoice = assertFound(
                await findOneWithDecryption(
                  tx,
                  SalesInvoice,
                  { id: allocation.invoiceId },
                  {},
                  { tenantId: payment.tenantId, organizationId: payment.organizationId },
                ),
                'sales.payments.invoice_not_found',
              )
              ensureSameScope(invoice, payment.organizationId, payment.tenantId)
              invoiceCache.set(allocation.invoiceId, invoice)
            }
          }
          const entity = tx.create(SalesPaymentAllocation, {
            payment,
            order,
            invoice,
            organizationId: payment.organizationId,
            tenantId: payment.tenantId,
            amount: toNumericString(allocation.amount) ?? '0',
            currencyCode: allocation.currencyCode,
            metadata: allocation.metadata ? cloneJson(allocation.metadata) : null,
          })
          tx.persist(entity)
        }
      } else if (input.amount !== undefined || input.currencyCode !== undefined) {
        // The caller changed the payment amount/currency without managing
        // allocations explicitly. A simple payment carries a single
        // auto-created allocation covering the full amount (see create); keep
        // it in sync so recomputeOrderPaymentTotals — which sums allocations in
        // preference to the payment amount — does not report a stale paid total
        // after a payment edit (#2455).
        const existingAllocations = await findWithDecryption(tx, SalesPaymentAllocation, { payment }, {}, { tenantId: payment.tenantId, organizationId: payment.organizationId })
        const paymentOrderId =
          (typeof payment.order === 'string' ? payment.order : payment.order?.id) ?? null
        const isDefaultAllocation = (allocation: SalesPaymentAllocation): boolean => {
          const allocationOrderId =
            typeof allocation.order === 'string' ? allocation.order : allocation.order?.id ?? null
          const allocationInvoiceId =
            typeof allocation.invoice === 'string' ? allocation.invoice : allocation.invoice?.id ?? null
          return allocationInvoiceId === null && allocationOrderId === paymentOrderId
        }
        if (existingAllocations.length === 1 && isDefaultAllocation(existingAllocations[0])) {
          const [allocation] = existingAllocations
          allocation.amount = toNumericString(toNumber(payment.amount)) ?? '0'
          allocation.currencyCode = payment.currencyCode
          tx.persist(allocation)
        }
      }
    })

    const nextOrderId =
      (payment.order as SalesOrder | null)?.id ??
      (typeof payment.order === 'string' ? payment.order : null)
    let totals: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number } | undefined
    if (nextOrderId) {
      totals = await em.transactional(async (tx) => {
        // Scope filter (#2111): never lock or recompute totals on a foreign
        // tenant's order, even if payment.order somehow points there.
        const lockedOrder = await findOneWithDecryption(
          tx,
          SalesOrder,
          { id: nextOrderId, organizationId: payment.organizationId, tenantId: payment.tenantId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          { tenantId: payment.tenantId, organizationId: payment.organizationId },
        )
        if (!lockedOrder) return undefined
        ensureSameScope(lockedOrder, payment.organizationId, payment.tenantId)
        const result = await recomputeOrderPaymentTotals(tx, lockedOrder)
        await tx.flush()
        return result
      })
      if (totals) {
        // Scope filter (#2111): same rationale as the lock above.
        const nextOrder = await findOneWithDecryption(em, SalesOrder, { id: nextOrderId, organizationId: payment.organizationId, tenantId: payment.tenantId }, {}, { tenantId: payment.tenantId, organizationId: payment.organizationId })
        if (nextOrder) {
          ensureSameScope(nextOrder, payment.organizationId, payment.tenantId)
          await invalidateOrderCache(ctx.container, nextOrder, ctx.auth?.tenantId ?? null)
        }
      }
    }
    if (previousOrder && (!nextOrderId || previousOrder.id !== nextOrderId)) {
      await em.transactional(async (tx) => {
        // Scope filter (#2111): previousOrder was already loaded via the
        // payment's scope, so its tenant/org match the payment's. Filter
        // the lock query the same way as defence-in-depth.
        const lockedOrder = await findOneWithDecryption(
          tx,
          SalesOrder,
          { id: previousOrder.id, organizationId: payment.organizationId, tenantId: payment.tenantId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          { tenantId: payment.tenantId, organizationId: payment.organizationId },
        )
        if (!lockedOrder) return
        ensureSameScope(lockedOrder, payment.organizationId, payment.tenantId)
        await recomputeOrderPaymentTotals(tx, lockedOrder)
        await tx.flush()
      })
      await invalidateOrderCache(ctx.container, previousOrder, ctx.auth?.tenantId ?? null)
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: payment,
      identifiers: {
        id: payment.id,
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
      },
      indexer: { entityType: E.sales.sales_payment },
      events: paymentCrudEvents,
    })

    return { paymentId: payment.id, orderTotals: totals }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = ctx.auth?.tenantId ? { tenantId: ctx.auth.tenantId, organizationId: ctx.auth?.orgId ?? null } : undefined
    return result?.paymentId ? loadPaymentSnapshot(em, result.paymentId, scope) : null
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PaymentSnapshot | undefined
    const after = snapshots.after as PaymentSnapshot | undefined
    return {
      actionLabel: translate('sales.audit.payments.update', 'Update payment'),
      resourceKind: 'sales.payment',
      resourceId: result.paymentId,
      parentResourceKind: 'sales.order',
      parentResourceId: after?.orderId ?? before?.orderId ?? null,
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restorePaymentSnapshot(em, before)
    await em.flush()
    if (before.orderId) {
      await em.transactional(async (tx) => {
        const order = await findOneWithDecryption(tx, SalesOrder, { id: before.orderId! }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: before.tenantId, organizationId: before.organizationId })
        if (!order) return
        await recomputeOrderPaymentTotals(tx, order)
        await tx.flush()
      })
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
    const scope = ctx.auth?.tenantId ? { tenantId: ctx.auth.tenantId, organizationId: ctx.auth?.orgId ?? null } : undefined
    const snapshot = await loadPaymentSnapshot(em, parsed.id, scope)
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const payment = assertFound(
      await findOneWithDecryption(
        em,
        SalesPayment,
        { id: input.id },
        { populate: ['order'] },
        { tenantId: input.tenantId, organizationId: input.organizationId },
      ),
      'sales.payments.not_found'
    )
    ensureSameScope(payment, input.organizationId, input.tenantId)
    const order = payment.order as SalesOrder | null
    const allocations = await findWithDecryption(em, SalesPaymentAllocation, { payment }, {}, { tenantId: payment.tenantId, organizationId: payment.organizationId })
    const allocationOrders = allocations
      .map((allocation) =>
        typeof allocation.order === 'string'
          ? allocation.order
          : allocation.order?.id ?? null
      )
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    // Remove the allocations and the payment in one transaction so a failure
    // between the two deletes cannot leave orphaned allocations committed
    // without their payment (#2336).
    await em.transactional(async (tx) => {
      allocations.forEach((allocation) => tx.remove(allocation))
      tx.remove(payment)
    })
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
      const recomputed = await em.transactional(async (tx) => {
        // Scope filter (#2111): never lock or recompute totals on a foreign
        // tenant's order, even if a payment allocation somehow points there.
        const lockedOrder = await findOneWithDecryption(
          tx,
          SalesOrder,
          { id: orderId, organizationId: payment.organizationId, tenantId: payment.tenantId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          { tenantId: payment.tenantId, organizationId: payment.organizationId },
        )
        if (!lockedOrder) return undefined
        ensureSameScope(lockedOrder, payment.organizationId, payment.tenantId)
        const result = await recomputeOrderPaymentTotals(tx, lockedOrder)
        await tx.flush()
        return result
      })
      if (recomputed && (!totals || (primaryOrderId && orderId === primaryOrderId))) {
        totals = recomputed
      }
      // Scope filter (#2111): same rationale as the lock above.
      const target = await findOneWithDecryption(em, SalesOrder, { id: orderId, organizationId: payment.organizationId, tenantId: payment.tenantId }, {}, { tenantId: payment.tenantId, organizationId: payment.organizationId })
      if (target) {
        ensureSameScope(target, payment.organizationId, payment.tenantId)
        await invalidateOrderCache(ctx.container, target, ctx.auth?.tenantId ?? null)
      }
    }
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: payment,
      identifiers: {
        id: payment.id,
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
      },
      indexer: { entityType: E.sales.sales_payment },
      events: paymentCrudEvents,
    })
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
      parentResourceKind: 'sales.order',
      parentResourceId: before?.orderId ?? null,
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restorePaymentSnapshot(em, before)
    await em.flush()
    if (before.orderId) {
      await em.transactional(async (tx) => {
        const order = await findOneWithDecryption(tx, SalesOrder, { id: before.orderId! }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: before.tenantId, organizationId: before.organizationId })
        if (!order) return
        await recomputeOrderPaymentTotals(tx, order)
        await tx.flush()
      })
    }
  },
}

export const paymentCommands = [createPaymentCommand, updatePaymentCommand, deletePaymentCommand]

registerCommand(createPaymentCommand)
registerCommand(updatePaymentCommand)
registerCommand(deletePaymentCommand)
