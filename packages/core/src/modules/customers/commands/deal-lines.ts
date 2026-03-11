import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealLine } from '../data/entities'
import {
  dealLineCreateSchema,
  dealLineUpdateSchema,
  dealLineReorderSchema,
  type DealLineCreateInput,
  type DealLineUpdateInput,
  type DealLineReorderInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  ensureSameScope,
  extractUndoPayload,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCustomersEvent } from '../events'

const dealLineCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'deal-line',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeLineTotal(
  quantity: number,
  unitPrice: number,
  discountPercent: number | null | undefined,
  discountAmount: number | null | undefined,
): number {
  const gross = quantity * unitPrice
  const percentDiscount = gross * ((discountPercent ?? 0) / 100)
  const total = gross - (discountAmount ?? 0) - percentDiscount
  return Math.max(0, total)
}

function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

async function updateDealValueFromLines(em: EntityManager, deal: CustomerDeal): Promise<void> {
  const lines = await em.find(CustomerDealLine, { deal, deletedAt: null })
  const sum = lines.reduce((acc, line) => acc + Number(line.lineTotal ?? 0), 0)
  deal.valueAmount = toNumericString(sum)
  await em.flush()
}

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

type DealLineSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  dealId: string
  lineNumber: number
  productId: string | null
  productVariantId: string | null
  name: string
  sku: string | null
  description: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  discountPercent: number | null
  discountAmount: number | null
  taxRate: number | null
  lineTotal: number
  currency: string | null
  productSnapshot: Record<string, unknown> | null
  deletedAt: Date | null
}

type DealLineUndoPayload = {
  before?: DealLineSnapshot | null
  after?: DealLineSnapshot | null
}

type DealLineReorderUndoPayload = {
  before: Array<{ id: string; lineNumber: number }>
}

function captureDealLineSnapshot(line: CustomerDealLine, deal: CustomerDeal): DealLineSnapshot {
  return {
    id: line.id,
    organizationId: line.organizationId,
    tenantId: line.tenantId,
    dealId: deal.id,
    lineNumber: line.lineNumber,
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name,
    sku: line.sku ?? null,
    description: line.description ?? null,
    quantity: line.quantity,
    unit: line.unit ?? null,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent ?? null,
    discountAmount: line.discountAmount ?? null,
    taxRate: line.taxRate ?? null,
    lineTotal: line.lineTotal,
    currency: line.currency ?? null,
    productSnapshot: line.productSnapshot ?? null,
    deletedAt: line.deletedAt ?? null,
  }
}

async function loadDealLineSnapshot(em: EntityManager, id: string): Promise<DealLineSnapshot | null> {
  const line = await em.findOne(CustomerDealLine, { id, deletedAt: null }, { populate: ['deal'] })
  if (!line) return null
  const deal = line.deal as CustomerDeal
  return captureDealLineSnapshot(line, deal)
}

async function requireDeal(
  em: EntityManager,
  dealId: string,
  organizationId: string,
  tenantId: string,
): Promise<CustomerDeal> {
  const deal = await em.findOne(CustomerDeal, { id: dealId, deletedAt: null })
  if (!deal) throw new CrudHttpError(404, { error: 'Deal not found' })
  ensureSameScope(deal, organizationId, tenantId)
  return deal
}

async function getNextLineNumber(em: EntityManager, deal: CustomerDeal): Promise<number> {
  const rows = await em.getConnection().execute<Array<{ max_line: number | null }>>(
    'SELECT MAX(line_number) AS max_line FROM customer_deal_lines WHERE deal_id = ? AND deleted_at IS NULL',
    [deal.id],
  )
  const maxLine = rows[0]?.max_line ?? 0
  return maxLine + 1
}

type ProductRow = {
  id: string
  title: string
  sku: string | null
  base_price: string | null
}

async function fetchProductSnapshot(
  em: EntityManager,
  productId: string,
): Promise<ProductRow | null> {
  const rows = await em.getConnection().execute<ProductRow[]>(
    'SELECT id, title, sku, "base_price" FROM catalog_products WHERE id = ? AND deleted_at IS NULL',
    [productId],
  )
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Create command
// ---------------------------------------------------------------------------

const createDealLineCommand: CommandHandler<DealLineCreateInput, { dealLineId: string }> = {
  id: 'customers.deal-line.create',
  async execute(rawInput, ctx) {
    const parsed = dealLineCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const deal = await requireDeal(em, parsed.dealId, parsed.organizationId, parsed.tenantId)

    let productSnapshotData: Record<string, unknown> | null = null
    if (parsed.productId) {
      const product = await fetchProductSnapshot(em, parsed.productId)
      if (product) {
        productSnapshotData = {
          id: product.id,
          title: product.title,
          sku: product.sku,
          basePrice: product.base_price,
        }
      }
    }

    const lineNumber = await getNextLineNumber(em, deal)
    const lineTotal = computeLineTotal(
      parsed.quantity,
      parsed.unitPrice,
      parsed.discountPercent,
      parsed.discountAmount,
    )

    const line = em.create(CustomerDealLine, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deal,
      lineNumber,
      productId: parsed.productId ?? null,
      productVariantId: parsed.productVariantId ?? null,
      name: parsed.name,
      sku: parsed.sku ?? null,
      description: parsed.description ?? null,
      quantity: parsed.quantity,
      unit: parsed.unit ?? null,
      unitPrice: parsed.unitPrice,
      discountPercent: parsed.discountPercent ?? null,
      discountAmount: parsed.discountAmount ?? null,
      taxRate: parsed.taxRate ?? null,
      lineTotal,
      currency: parsed.currency ?? null,
      productSnapshot: productSnapshotData,
    })
    em.persist(line)
    await em.flush()

    await updateDealValueFromLines(em, deal)

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: line,
      identifiers: {
        id: line.id,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      },
      events: dealLineCrudEvents,
    })

    await emitCustomersEvent('customers.deal.line.created', {
      id: line.id,
      dealId: deal.id,
      organizationId: line.organizationId,
      tenantId: line.tenantId,
    })

    return { dealLineId: line.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadDealLineSnapshot(em, result.dealLineId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as DealLineSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.deal-lines.create', 'Create deal line'),
      resourceKind: 'customers.deal-line',
      resourceId: result.dealLineId,
      parentResourceKind: 'customers.deal',
      parentResourceId: snapshot?.dealId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies DealLineUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const dealLineId = logEntry?.resourceId
    if (!dealLineId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await em.findOne(CustomerDealLine, { id: dealLineId }, { populate: ['deal'] })
    if (!line) return
    const deal = line.deal as CustomerDeal
    line.deletedAt = new Date()
    await em.flush()
    await updateDealValueFromLines(em, deal)
  },
}

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

const updateDealLineCommand: CommandHandler<DealLineUpdateInput, { dealLineId: string }> = {
  id: 'customers.deal-line.update',
  async prepare(rawInput, ctx) {
    const parsed = dealLineUpdateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadDealLineSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = dealLineUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await em.findOne(CustomerDealLine, { id: parsed.id, deletedAt: null }, { populate: ['deal'] })
    if (!line) throw new CrudHttpError(404, { error: 'Deal line not found' })
    ensureTenantScope(ctx, line.tenantId)
    ensureOrganizationScope(ctx, line.organizationId)

    if (parsed.name !== undefined) line.name = parsed.name
    if (parsed.sku !== undefined) line.sku = parsed.sku ?? null
    if (parsed.description !== undefined) line.description = parsed.description ?? null
    if (parsed.productId !== undefined) line.productId = parsed.productId ?? null
    if (parsed.productVariantId !== undefined) line.productVariantId = parsed.productVariantId ?? null
    if (parsed.quantity !== undefined) line.quantity = parsed.quantity
    if (parsed.unit !== undefined) line.unit = parsed.unit ?? null
    if (parsed.unitPrice !== undefined) line.unitPrice = parsed.unitPrice
    if (parsed.discountPercent !== undefined) line.discountPercent = parsed.discountPercent ?? null
    if (parsed.discountAmount !== undefined) line.discountAmount = parsed.discountAmount ?? null
    if (parsed.taxRate !== undefined) line.taxRate = parsed.taxRate ?? null
    if (parsed.currency !== undefined) line.currency = parsed.currency ?? null

    const priceFieldChanged =
      parsed.quantity !== undefined ||
      parsed.unitPrice !== undefined ||
      parsed.discountPercent !== undefined ||
      parsed.discountAmount !== undefined

    if (priceFieldChanged) {
      line.lineTotal = computeLineTotal(
        line.quantity,
        line.unitPrice,
        line.discountPercent,
        line.discountAmount,
      )
    }

    if (parsed.productId !== undefined && parsed.productId) {
      const product = await fetchProductSnapshot(em, parsed.productId)
      if (product) {
        line.productSnapshot = {
          id: product.id,
          title: product.title,
          sku: product.sku,
          basePrice: product.base_price,
        }
      }
    }

    await em.flush()

    const deal = line.deal as CustomerDeal
    if (priceFieldChanged) {
      await updateDealValueFromLines(em, deal)
    }

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: line,
      identifiers: {
        id: line.id,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      },
      events: dealLineCrudEvents,
    })

    await emitCustomersEvent('customers.deal.line.updated', {
      id: line.id,
      dealId: deal.id,
      organizationId: line.organizationId,
      tenantId: line.tenantId,
    })

    return { dealLineId: line.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadDealLineSnapshot(em, result.dealLineId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as DealLineSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as DealLineSnapshot | undefined
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            ['name', 'sku', 'description', 'quantity', 'unitPrice', 'discountPercent', 'discountAmount', 'taxRate', 'lineTotal', 'currency', 'productId'],
          )
        : {}
    return {
      actionLabel: translate('customers.audit.deal-lines.update', 'Update deal line'),
      resourceKind: 'customers.deal-line',
      resourceId: before.id,
      parentResourceKind: 'customers.deal',
      parentResourceId: before.dealId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies DealLineUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DealLineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await em.findOne(CustomerDealLine, { id: before.id }, { populate: ['deal'] })
    if (!line) return

    line.name = before.name
    line.sku = before.sku
    line.description = before.description
    line.productId = before.productId
    line.productVariantId = before.productVariantId
    line.quantity = before.quantity
    line.unit = before.unit
    line.unitPrice = before.unitPrice
    line.discountPercent = before.discountPercent
    line.discountAmount = before.discountAmount
    line.taxRate = before.taxRate
    line.lineTotal = before.lineTotal
    line.currency = before.currency
    line.productSnapshot = before.productSnapshot
    await em.flush()

    const deal = line.deal as CustomerDeal
    await updateDealValueFromLines(em, deal)

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: line,
      identifiers: {
        id: line.id,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      },
      events: dealLineCrudEvents,
    })
  },
}

// ---------------------------------------------------------------------------
// Delete command
// ---------------------------------------------------------------------------

const deleteDealLineCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { dealLineId: string }> = {
  id: 'customers.deal-line.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Deal line id required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadDealLineSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Deal line id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await em.findOne(CustomerDealLine, { id, deletedAt: null }, { populate: ['deal'] })
    if (!line) throw new CrudHttpError(404, { error: 'Deal line not found' })
    ensureTenantScope(ctx, line.tenantId)
    ensureOrganizationScope(ctx, line.organizationId)

    const deal = line.deal as CustomerDeal
    line.deletedAt = new Date()
    await em.flush()

    await updateDealValueFromLines(em, deal)

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: line,
      identifiers: {
        id: line.id,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      },
      events: dealLineCrudEvents,
    })

    await emitCustomersEvent('customers.deal.line.deleted', {
      id: line.id,
      dealId: deal.id,
      organizationId: line.organizationId,
      tenantId: line.tenantId,
    })

    return { dealLineId: line.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as DealLineSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.deal-lines.delete', 'Delete deal line'),
      resourceKind: 'customers.deal-line',
      resourceId: before.id,
      parentResourceKind: 'customers.deal',
      parentResourceId: before.dealId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies DealLineUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DealLineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let line = await em.findOne(CustomerDealLine, { id: before.id })
    const deal = await em.findOne(CustomerDeal, { id: before.dealId })
    if (!deal) return

    if (!line) {
      line = em.create(CustomerDealLine, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        deal,
        lineNumber: before.lineNumber,
        productId: before.productId,
        productVariantId: before.productVariantId,
        name: before.name,
        sku: before.sku,
        description: before.description,
        quantity: before.quantity,
        unit: before.unit,
        unitPrice: before.unitPrice,
        discountPercent: before.discountPercent,
        discountAmount: before.discountAmount,
        taxRate: before.taxRate,
        lineTotal: before.lineTotal,
        currency: before.currency,
        productSnapshot: before.productSnapshot,
      })
      em.persist(line)
    } else {
      line.deletedAt = null
      line.lineNumber = before.lineNumber
      line.productId = before.productId
      line.productVariantId = before.productVariantId
      line.name = before.name
      line.sku = before.sku
      line.description = before.description
      line.quantity = before.quantity
      line.unit = before.unit
      line.unitPrice = before.unitPrice
      line.discountPercent = before.discountPercent
      line.discountAmount = before.discountAmount
      line.taxRate = before.taxRate
      line.lineTotal = before.lineTotal
      line.currency = before.currency
      line.productSnapshot = before.productSnapshot
    }
    await em.flush()

    await updateDealValueFromLines(em, deal)

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: line,
      identifiers: {
        id: line.id,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      },
      events: dealLineCrudEvents,
    })
  },
}

// ---------------------------------------------------------------------------
// Reorder command
// ---------------------------------------------------------------------------

const reorderDealLinesCommand: CommandHandler<DealLineReorderInput, { reordered: number }> = {
  id: 'customers.deal-line.reorder',
  async execute(rawInput, ctx) {
    const parsed = dealLineReorderSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const deal = await requireDeal(em, parsed.dealId, parsed.organizationId, parsed.tenantId)

    const lines = await em.find(CustomerDealLine, {
      deal,
      id: { $in: parsed.lineIds },
      deletedAt: null,
    })

    const lineMap = new Map(lines.map((line) => [line.id, line]))
    let updated = 0

    for (let index = 0; index < parsed.lineIds.length; index++) {
      const lineId = parsed.lineIds[index]
      const line = lineMap.get(lineId)
      if (line && line.lineNumber !== index + 1) {
        line.lineNumber = index + 1
        updated++
      }
    }

    if (updated > 0) {
      await em.flush()

      await emitCustomersEvent('customers.deal.line.reordered', {
        dealId: deal.id,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        lineIds: parsed.lineIds,
        updatedCount: updated,
      })
    }

    return { reordered: updated }
  },
  async prepare(rawInput, ctx) {
    const parsed = dealLineReorderSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const deal = await em.findOne(CustomerDeal, { id: parsed.dealId, deletedAt: null })
    if (!deal) return {}
    const lines = await em.find(CustomerDealLine, {
      deal,
      id: { $in: parsed.lineIds },
      deletedAt: null,
    })
    const previousOrder = lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
    }))
    return { before: { previousOrder } }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as { previousOrder: Array<{ id: string; lineNumber: number }> } | undefined
    return {
      actionLabel: translate('customers.audit.deal-lines.reorder', 'Reorder deal lines'),
      resourceKind: 'customers.deal-line',
      resourceId: null,
      payload: {
        undo: {
          before: before?.previousOrder ?? [],
        } satisfies DealLineReorderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DealLineReorderUndoPayload>(logEntry)
    const previousOrder = payload?.before
    if (!previousOrder || !previousOrder.length) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    for (const entry of previousOrder) {
      const line = await em.findOne(CustomerDealLine, { id: entry.id })
      if (line) {
        line.lineNumber = entry.lineNumber
      }
    }
    await em.flush()
  },
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerCommand(createDealLineCommand)
registerCommand(updateDealLineCommand)
registerCommand(deleteDealLineCommand)
registerCommand(reorderDealLinesCommand)
