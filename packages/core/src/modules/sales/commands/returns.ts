import { randomUUID } from 'crypto'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'
import type { SalesCalculationService } from '../services/salesCalculationService'
import type { SalesAdjustmentDraft, SalesLineSnapshot, SalesDocumentCalculationResult } from '../lib/types'
import { cloneJson, ensureOrganizationScope, ensureSameScope, ensureTenantScope, extractUndoPayload, toNumericString } from './shared'
import { SalesOrder, SalesOrderAdjustment, SalesOrderLine, SalesReturn, SalesReturnLine } from '../data/entities'
import { returnCreateSchema, type ReturnCreateInput } from '../data/validators'
import { E } from '#generated/entities.ids.generated'

type ReturnLineInput = { orderLineId: string; quantity: number }

type ReturnSnapshot = {
  id: string
  orderId: string
  organizationId: string
  tenantId: string
  returnNumber: string
  returnedAt: string | null
  reason: string | null
  notes: string | null
  lines: Array<{
    id: string
    orderLineId: string
    quantityReturned: number
    unitPriceNet: number
    unitPriceGross: number
    totalNetAmount: number
    totalGrossAmount: number
  }>
  adjustmentIds: string[]
}

type ReturnUndoPayload = {
  after?: ReturnSnapshot | null
}

const returnCrudEvents: CrudEventsConfig = {
  module: 'sales',
  entity: 'return',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

function toNumeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4
}

function applyOrderTotals(order: SalesOrder, totals: SalesDocumentCalculationResult['totals'], lineCount: number): void {
  order.subtotalNetAmount = toNumericString(totals.subtotalNetAmount) ?? '0'
  order.subtotalGrossAmount = toNumericString(totals.subtotalGrossAmount) ?? '0'
  order.discountTotalAmount = toNumericString(totals.discountTotalAmount) ?? '0'
  order.taxTotalAmount = toNumericString(totals.taxTotalAmount) ?? '0'
  order.shippingNetAmount = toNumericString(totals.shippingNetAmount) ?? '0'
  order.shippingGrossAmount = toNumericString(totals.shippingGrossAmount) ?? '0'
  order.surchargeTotalAmount = toNumericString(totals.surchargeTotalAmount) ?? '0'
  order.grandTotalNetAmount = toNumericString(totals.grandTotalNetAmount) ?? '0'
  order.grandTotalGrossAmount = toNumericString(totals.grandTotalGrossAmount) ?? '0'
  order.paidTotalAmount = toNumericString(totals.paidTotalAmount) ?? '0'
  order.refundedTotalAmount = toNumericString(totals.refundedTotalAmount) ?? '0'
  order.outstandingAmount = toNumericString(totals.outstandingAmount) ?? '0'
  order.totalsSnapshot = cloneJson(totals)
  order.lineItemCount = lineCount
}

function mapOrderLineEntityToSnapshot(line: SalesOrderLine): SalesLineSnapshot {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    kind: line.kind,
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: toNumeric(line.quantity),
    quantityUnit: line.quantityUnit ?? null,
    normalizedQuantity: toNumeric(line.normalizedQuantity ?? line.quantity),
    normalizedUnit: line.normalizedUnit ?? line.quantityUnit ?? null,
    uomSnapshot: line.uomSnapshot ? cloneJson(line.uomSnapshot) : null,
    currencyCode: line.currencyCode,
    unitPriceNet: toNumeric(line.unitPriceNet),
    unitPriceGross: toNumeric(line.unitPriceGross),
    discountAmount: toNumeric(line.discountAmount),
    discountPercent: toNumeric(line.discountPercent),
    taxRate: toNumeric(line.taxRate),
    taxAmount: toNumeric(line.taxAmount),
    totalNetAmount: toNumeric(line.totalNetAmount),
    totalGrossAmount: toNumeric(line.totalGrossAmount),
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: line.customFieldSetId ?? null,
  }
}

function mapOrderAdjustmentToDraft(adjustment: SalesOrderAdjustment): SalesAdjustmentDraft {
  return {
    id: adjustment.id,
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind,
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: toNumeric(adjustment.rate),
    amountNet: toNumeric(adjustment.amountNet),
    amountGross: toNumeric(adjustment.amountGross),
    currencyCode: adjustment.currencyCode ?? null,
    metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
    position: adjustment.position ?? 0,
  }
}

function buildCalculationContext(order: SalesOrder) {
  return {
    tenantId: order.tenantId,
    organizationId: order.organizationId,
    currencyCode: order.currencyCode,
    metadata: {
      shippingMethod: order.shippingMethodSnapshot
        ? cloneJson(order.shippingMethodSnapshot as Record<string, unknown>)
        : null,
      paymentMethod: order.paymentMethodSnapshot ? cloneJson(order.paymentMethodSnapshot as Record<string, unknown>) : null,
    },
  }
}

/**
 * Recalculates order totals (including line-scoped return adjustments) for display.
 * Returns the totals object to merge into an order API response, or null if order not found.
 */
export async function recalculateOrderTotalsForDisplay(
  em: EntityManager,
  container: { resolve: (key: string) => unknown },
  orderId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<SalesDocumentCalculationResult['totals'] | null> {
  const order = await findOneWithDecryption(
    em,
    SalesOrder,
    { id: orderId, deletedAt: null },
    {},
    scope,
  )
  if (!order) return null
  const [orderLines, adjustments] = await Promise.all([
    findWithDecryption(em, SalesOrderLine, { order: order.id, deletedAt: null }, {}, scope),
    findWithDecryption(
      em,
      SalesOrderAdjustment,
      { order: order.id, deletedAt: null },
      { orderBy: { position: 'asc' } },
      scope,
    ),
  ])
  const lineSnapshots: SalesLineSnapshot[] = orderLines.map(mapOrderLineEntityToSnapshot)
  const adjustmentDrafts: SalesAdjustmentDraft[] = adjustments.map(mapOrderAdjustmentToDraft)
  const salesCalculationService = container.resolve('salesCalculationService') as SalesCalculationService
  const calculation = await salesCalculationService.calculateDocumentTotals({
    documentKind: 'order',
    lines: lineSnapshots,
    adjustments: adjustmentDrafts,
    context: buildCalculationContext(order),
    existingTotals: {
      paidTotalAmount: toNumeric(order.paidTotalAmount),
      refundedTotalAmount: toNumeric(order.refundedTotalAmount),
    },
  })
  return calculation.totals
}

export async function loadReturnSnapshot(em: EntityManager, id: string): Promise<ReturnSnapshot | null> {
  const header = await findOneWithDecryption(
    em,
    SalesReturn,
    { id, deletedAt: null },
    { populate: ['order'] },
    {},
  )
  if (!header || !header.order) return null
  const orderId = typeof header.order === 'string' ? header.order : header.order.id
  const lines = await findWithDecryption(
    em,
    SalesReturnLine,
    { salesReturn: header.id, deletedAt: null },
    { populate: ['orderLine'] },
    { tenantId: header.tenantId, organizationId: header.organizationId },
  )
  const adjustmentIds: string[] = []
  const adjustments = await findWithDecryption(
    em,
    SalesOrderAdjustment,
    { order: orderId, kind: 'return', deletedAt: null },
    {},
    { tenantId: header.tenantId, organizationId: header.organizationId },
  )
  adjustments.forEach((adj) => {
    const meta = adj.metadata as Record<string, unknown> | null | undefined
    if (meta && meta.returnId === header.id) adjustmentIds.push(adj.id)
  })

  return {
    id: header.id,
    orderId,
    organizationId: header.organizationId,
    tenantId: header.tenantId,
    returnNumber: header.returnNumber,
    returnedAt: header.returnedAt ? header.returnedAt.toISOString() : null,
    reason: header.reason ?? null,
    notes: header.notes ?? null,
    lines: lines.map((line) => ({
      id: line.id,
      orderLineId: typeof line.orderLine === 'string' ? line.orderLine : line.orderLine?.id ?? null,
      quantityReturned: toNumeric(line.quantityReturned),
      unitPriceNet: toNumeric(line.unitPriceNet),
      unitPriceGross: toNumeric(line.unitPriceGross),
      totalNetAmount: toNumeric(line.totalNetAmount),
      totalGrossAmount: toNumeric(line.totalGrossAmount),
    })),
    adjustmentIds,
  }
}

function normalizeLinesInput(lines: ReturnCreateInput['lines']): ReturnLineInput[] {
  const seen = new Set<string>()
  const result: ReturnLineInput[] = []
  for (const line of lines) {
    const orderLineId = line.orderLineId
    if (!orderLineId || seen.has(orderLineId)) continue
    const quantity = toNumeric(line.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    seen.add(orderLineId)
    result.push({ orderLineId, quantity })
  }
  return result
}

const createReturnCommand: CommandHandler<ReturnCreateInput, { returnId: string }> = {
  id: 'sales.returns.create',
  async execute(rawInput, ctx) {
    const input = returnCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const order = await findOneWithDecryption(
      em,
      SalesOrder,
      { id: input.orderId, deletedAt: null },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!order) {
      throw new CrudHttpError(404, { error: translate('sales.returns.orderMissing', 'Order not found.') })
    }
    ensureSameScope(order, input.organizationId, input.tenantId)

    const requested = normalizeLinesInput(input.lines)
    if (!requested.length) {
      throw new CrudHttpError(400, { error: translate('sales.returns.linesRequired', 'Select at least one line to return.') })
    }

    const orderLines = await findWithDecryption(
      em,
      SalesOrderLine,
      { order: order.id, deletedAt: null },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    const lineMap = new Map(orderLines.map((line) => [line.id, line]))

    requested.forEach(({ orderLineId, quantity }) => {
      const line = lineMap.get(orderLineId)
      if (!line) {
        throw new CrudHttpError(404, { error: translate('sales.returns.lineMissing', 'Order line not found.') })
      }
      const available = toNumeric(line.quantity) - toNumeric(line.returnedQuantity)
      if (quantity - 1e-6 > available) {
        throw new CrudHttpError(400, { error: translate('sales.returns.quantityExceeded', 'Cannot return more than the remaining quantity.') })
      }
    })

    const existingAdjustments = await findWithDecryption(
      em,
      SalesOrderAdjustment,
      { order: order.id, deletedAt: null },
      { orderBy: { position: 'asc' } },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    const positionStart = existingAdjustments.reduce((acc, adj) => Math.max(acc, adj.position ?? 0), 0) + 1

    const numberGenerator = new SalesDocumentNumberGenerator(em)
    const generated = await numberGenerator.generate({
      kind: 'return',
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    const returnId = randomUUID()
    const header = em.create(SalesReturn, {
      id: returnId,
      order,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      returnNumber: generated.number,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      returnedAt: input.returnedAt ?? new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(header)

    const createdAdjustments: SalesOrderAdjustment[] = []
    const createdLines: SalesReturnLine[] = []
    requested.forEach((lineInput, index) => {
      const line = lineMap.get(lineInput.orderLineId)
      if (!line) return
      const quantity = lineInput.quantity
      const lineQuantity = Math.max(toNumeric(line.quantity), 0)
      const unitNet = lineQuantity > 0 ? toNumeric(line.totalNetAmount) / lineQuantity : toNumeric(line.unitPriceNet)
      const unitGross = lineQuantity > 0 ? toNumeric(line.totalGrossAmount) / lineQuantity : toNumeric(line.unitPriceGross)
      const totalNet = -round(Math.max(unitNet, 0) * quantity)
      const totalGross = -round(Math.max(unitGross, 0) * quantity)

      const returnLineId = randomUUID()
      const returnLine = em.create(SalesReturnLine, {
        id: returnLineId,
        salesReturn: header,
        orderLine: em.getReference(SalesOrderLine, line.id),
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        quantityReturned: quantity.toString(),
        unitPriceNet: round(unitNet).toString(),
        unitPriceGross: round(unitGross).toString(),
        totalNetAmount: totalNet.toString(),
        totalGrossAmount: totalGross.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      createdLines.push(returnLine)
      em.persist(returnLine)

      const adjustment = em.create(SalesOrderAdjustment, {
        id: randomUUID(),
        order,
        orderLine: em.getReference(SalesOrderLine, line.id),
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        scope: 'line',
        kind: 'return',
        rate: '0',
        amountNet: totalNet.toString(),
        amountGross: totalGross.toString(),
        currencyCode: order.currencyCode,
        metadata: { returnId, returnLineId },
        position: positionStart + index,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      createdAdjustments.push(adjustment)
      em.persist(adjustment)

      line.returnedQuantity = (toNumeric(line.returnedQuantity) + quantity).toString()
      line.updatedAt = new Date()
      em.persist(line)
    })

    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const lineSnapshots: SalesLineSnapshot[] = orderLines.map(mapOrderLineEntityToSnapshot)
    const adjustmentDrafts: SalesAdjustmentDraft[] = [...existingAdjustments, ...createdAdjustments].map(mapOrderAdjustmentToDraft)
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: buildCalculationContext(order),
    })
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    order.updatedAt = new Date()
    em.persist(order)

    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: header,
      identifiers: { id: header.id, organizationId: header.organizationId, tenantId: header.tenantId },
      indexer: { entityType: E.sales.sales_return },
      events: returnCrudEvents,
    })

    if (createdLines.length) {
      await Promise.all(
        createdLines.map((line) =>
          emitCrudSideEffects({
            dataEngine,
            action: 'created',
            entity: line,
            identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
            indexer: { entityType: E.sales.sales_return_line },
          }),
        ),
      )
    }

    return { returnId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadReturnSnapshot(em, result.returnId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as ReturnSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.returns.create', 'Create return'),
      resourceKind: 'sales.return',
      resourceId: result.returnId,
      parentResourceKind: 'sales.order',
      parentResourceId: after.orderId ?? null,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies ReturnUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReturnUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await findOneWithDecryption(
      em,
      SalesOrder,
      { id: after.orderId, deletedAt: null },
      {},
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!order) return

    const lines = await findWithDecryption(
      em,
      SalesOrderLine,
      { order: order.id, deletedAt: null },
      {},
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    const lineMap = new Map(lines.map((line) => [line.id, line]))
    after.lines.forEach((entry) => {
      const line = lineMap.get(entry.orderLineId)
      if (!line) return
      const next = Math.max(0, toNumeric(line.returnedQuantity) - entry.quantityReturned)
      line.returnedQuantity = next.toString()
      line.updatedAt = new Date()
      em.persist(line)
    })

    if (after.adjustmentIds.length) {
      const adjustments = await findWithDecryption(
        em,
        SalesOrderAdjustment,
        { id: { $in: after.adjustmentIds }, deletedAt: null },
        {},
        { tenantId: after.tenantId, organizationId: after.organizationId },
      )
      adjustments.forEach((adj) => em.remove(adj))
    }

    const header = await findOneWithDecryption(
      em,
      SalesReturn,
      { id: after.id, deletedAt: null },
      {},
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    const returnLines = await findWithDecryption(
      em,
      SalesReturnLine,
      { salesReturn: after.id, deletedAt: null },
      {},
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    returnLines.forEach((line) => em.remove(line))
    if (header) em.remove(header)

    const existingAdjustments = await findWithDecryption(
      em,
      SalesOrderAdjustment,
      { order: order.id, deletedAt: null },
      { orderBy: { position: 'asc' } },
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const lineSnapshots: SalesLineSnapshot[] = lines.map(mapOrderLineEntityToSnapshot)
    const adjustmentDrafts: SalesAdjustmentDraft[] = existingAdjustments.map(mapOrderAdjustmentToDraft)
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: buildCalculationContext(order),
    })
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    order.updatedAt = new Date()
    em.persist(order)

    await em.flush()
  },
}

registerCommand(createReturnCommand)

export const returnCommands = [createReturnCommand]

