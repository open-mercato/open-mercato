import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import {
  PurchaseOrder,
  PurchaseOrderLine,
  ReorderingRule,
} from '../data/entities'
import type { PurchaseDocumentNumberGenerator } from './purchaseDocumentNumberGenerator'
import type { VendorPricelistService } from './vendorPricelistService'

type Scope = {
  organizationId: string
  tenantId: string
}

export type ReorderingEvaluationItem = {
  ruleId: string
  productId: string
  minQuantity: number
  maxQuantity: number
  virtualStock: number
  quantityToOrder: number
  vendorId: string
  orderId: string
  orderNumber: string
  action: 'created' | 'updated'
}

export type ReorderingRunResult = {
  evaluatedCount: number
  triggeredCount: number
  ordersCreated: number
  ordersUpdated: number
  items: ReorderingEvaluationItem[]
}

export class ReorderingEngine {
  constructor(
    private readonly em: EntityManager,
    private readonly numberGenerator: PurchaseDocumentNumberGenerator,
    private readonly pricelistService?: VendorPricelistService | null,
    private readonly eventBus?: EventBus | null
  ) {}

  async runReplenishment(
    scope: Scope,
    options?: {
      ruleId?: string
      productId?: string
      warehouseId?: string
      currentStockProvider?: (productId: string, warehouseId?: string | null) => Promise<number> | number
    }
  ): Promise<ReorderingRunResult> {
    const whereClause: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      deletedAt: null,
    }

    if (options?.ruleId) whereClause.id = options.ruleId
    if (options?.productId) whereClause.productId = options.productId
    if (options?.warehouseId) whereClause.warehouseId = options.warehouseId

    const rules = await this.em.find(ReorderingRule, whereClause)

    const result: ReorderingRunResult = {
      evaluatedCount: rules.length,
      triggeredCount: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      items: [],
    }

    if (rules.length === 0) {
      return result
    }

    const now = new Date()

    // Process each rule
    for (const rule of rules) {
      const minQty = Number(rule.minQuantity)
      const maxQty = Number(rule.maxQuantity)
      const multiple = Number(rule.quantityMultiple) || 1

      // 1. Current stock
      let currentStock = 0
      if (options?.currentStockProvider) {
        currentStock = await options.currentStockProvider(rule.productId, rule.warehouseId)
      }

      // 2. Inbound stock from active purchase orders (status = purchase_order or to_approve)
      const activeLines = await this.em.find(
        PurchaseOrderLine,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          productId: rule.productId,
          purchaseOrder: {
            status: { $in: ['purchase_order', 'to_approve'] },
            deletedAt: null,
          },
          deletedAt: null,
        },
        { populate: ['purchaseOrder'] }
      )

      let inboundStock = 0
      for (const line of activeLines) {
        const remaining = Math.max(0, Number(line.quantityOrdered) - Number(line.quantityReceived))
        inboundStock += remaining
      }

      // 3. Virtual available = current + inbound
      const virtualStock = currentStock + inboundStock

      // If virtualStock is at or above minQuantity, replenishment is not triggered
      if (virtualStock >= minQty) {
        continue
      }

      // 4. Calculate quantity to order
      const rawNeeded = maxQty - virtualStock
      if (rawNeeded <= 0) {
        continue
      }

      // Round up to quantityMultiple
      const quantityToOrder = Math.ceil(rawNeeded / multiple) * multiple
      result.triggeredCount++

      // 5. Vendor determination
      const vendorId = rule.preferredVendorId
      if (!vendorId) {
        // Without vendor we cannot generate draft RFQ
        continue
      }

      // 6. Resolve price and SKU from Vendor Pricelist if available
      let unitPrice = '0.0000'
      let vendorProductCode: string | null = null
      let productDescription = `Product ${rule.productId}`

      try {
        const rows = await this.em.getConnection().execute<{ title?: string }[]>(
          'SELECT title FROM catalog_products WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [rule.productId]
        )
        if (rows?.[0]?.title) {
          productDescription = rows[0].title
        }
      } catch {
        // Fallback to default description if catalog_products table is not available
      }

      if (this.pricelistService) {
        const bestPrice = await this.pricelistService.resolveBestPrice(scope, {
          vendorId,
          productId: rule.productId,
          quantity: quantityToOrder,
        })
        if (bestPrice) {
          unitPrice = bestPrice.price
          vendorProductCode = bestPrice.vendorProductCode ?? null
        }
      }

      // 7. Find existing draft RFQ for this vendor to append, or create a new one
      const existingDraft = await this.em.findOne(
        PurchaseOrder,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          vendorId,
          status: 'draft_rfq',
          deletedAt: null,
        },
        { populate: ['lines'] }
      )

      let action: 'created' | 'updated' = 'updated'
      let activeOrder: PurchaseOrder

      if (!existingDraft) {
        action = 'created'
        const orderNumber = await this.numberGenerator.generateNumber('rfq', scope)
        activeOrder = this.em.create(PurchaseOrder, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          orderNumber,
          status: 'draft_rfq',
          vendorId,
          orderDate: now,
          currencyCode: 'PLN',
          notes: 'Auto-generated by Reordering Engine',
          createdAt: now,
          updatedAt: now,
        })
        result.ordersCreated++
      } else {
        activeOrder = existingDraft
        result.ordersUpdated++
      }

      // Check if line with this productId already in draft order
      const existingLine = activeOrder.lines
        .getItems()
        .find((l) => l.productId === rule.productId)

      if (existingLine) {
        const newQty = Number(existingLine.quantityOrdered) + quantityToOrder
        existingLine.quantityOrdered = newQty.toFixed(4)
        const lineNet = newQty * Number(existingLine.unitPriceNet)
        existingLine.subtotalNet = lineNet.toFixed(4)
        existingLine.totalGross = (lineNet * 1.23).toFixed(4)
        existingLine.updatedAt = now
      } else {
        const lineNet = quantityToOrder * Number(unitPrice)
        this.em.create(PurchaseOrderLine, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          purchaseOrder: activeOrder,
          productId: rule.productId,
          vendorProductCode,
          productDescription,
          quantityOrdered: quantityToOrder.toFixed(4),
          quantityReceived: '0.0000',
          quantityBilled: '0.0000',
          unitPriceNet: Number(unitPrice).toFixed(4),
          taxRatePercent: '23.00',
          subtotalNet: lineNet.toFixed(4),
          totalTax: (lineNet * 0.23).toFixed(4),
          totalGross: (lineNet * 1.23).toFixed(4),
          createdAt: now,
          updatedAt: now,
        })
      }

      // Recalculate draft order totals
      let totalNet = 0
      let totalTax = 0
      let totalGross = 0
      for (const l of activeOrder.lines.getItems()) {
        totalNet += Number(l.subtotalNet)
        totalTax += Number(l.totalTax)
        totalGross += Number(l.totalGross)
      }
      activeOrder.subtotalNet = totalNet.toFixed(4)
      activeOrder.totalTax = totalTax.toFixed(4)
      activeOrder.totalGross = totalGross.toFixed(4)
      activeOrder.updatedAt = now

      await this.em.persist(activeOrder).flush()

      result.items.push({
        ruleId: rule.id,
        productId: rule.productId,
        minQuantity: minQty,
        maxQuantity: maxQty,
        virtualStock,
        quantityToOrder,
        vendorId,
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        action,
      })
    }

    if (this.eventBus) {
      await this.eventBus.emit('purchases.reorder.executed', {
        evaluatedCount: result.evaluatedCount,
        triggeredCount: result.triggeredCount,
        ordersCreated: result.ordersCreated,
        ordersUpdated: result.ordersUpdated,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }

    return result
  }
}
