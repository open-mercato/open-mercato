import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseSettings,
  type PurchaseOrderStatus,
} from '../data/entities'
import type { PurchaseCalculationService } from './purchaseCalculationService'
import type { PurchaseDocumentNumberGenerator } from './purchaseDocumentNumberGenerator'
import type { PurchaseReceiptService } from './purchaseReceiptService'
import type { PurchaseOrderCreateInput, PurchaseOrderUpdateInput } from '../data/validators'

type Scope = {
  organizationId: string
  tenantId: string
}

export class PurchaseOrderService {
  constructor(
    private readonly em: EntityManager,
    private readonly calculationService: PurchaseCalculationService,
    private readonly numberGenerator: PurchaseDocumentNumberGenerator,
    private readonly eventBus?: EventBus | null,
    private readonly receiptService?: PurchaseReceiptService | null
  ) {}

  async getSettings(scope: Scope): Promise<PurchaseSettings> {
    let settings = await this.em.findOne(PurchaseSettings, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    if (!settings) {
      settings = this.em.create(PurchaseSettings, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        approvalThresholdAmount: '10000.0000',
        approvalThresholdCurrency: 'PLN',
        doubleValidationEnabled: true,
        defaultControlPolicy: 'on_received',
        autoCreateReceiptOnConfirm: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await this.em.persist(settings).flush()
    }

    return settings
  }

  async createOrder(
    scope: Scope,
    input: PurchaseOrderCreateInput,
    _userId?: string | null
  ): Promise<PurchaseOrder> {
    const orderNumber = await this.numberGenerator.generateNumber('rfq', scope)
    const now = new Date()

    const order = this.em.create(PurchaseOrder, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderNumber,
      status: 'draft_rfq',
      vendorId: input.vendorId,
      vendorName: input.vendorName ?? null,
      buyerId: input.buyerId ?? null,
      orderDate: input.orderDate ? new Date(input.orderDate) : now,
      expectedArrivalDate: input.expectedArrivalDate ? new Date(input.expectedArrivalDate) : null,
      currencyCode: input.currencyCode || 'PLN',
      exchangeRate: String(input.exchangeRate || 1.0),
      paymentTermId: input.paymentTermId ?? null,
      incoterm: input.incoterm ?? null,
      controlPolicy: input.controlPolicy || 'on_received',
      notes: input.notes ?? null,
      approvalStatus: 'not_required',
      invoiceStatus: 'no',
      deliveryStatus: 'pending',
      subtotalNet: '0.0000',
      totalTax: '0.0000',
      totalGross: '0.0000',
      createdAt: now,
      updatedAt: now,
    })

    const calculatedLines = (input.lines ?? []).map((line, idx) => {
      const calc = this.calculationService.calculateLine({
        quantityOrdered: line.quantityOrdered,
        unitPriceNet: line.unitPriceNet,
        taxRatePercent: line.taxRatePercent ?? 23,
      })

      return this.em.create(PurchaseOrderLine, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        purchaseOrder: order,
        productId: line.productId ?? null,
        vendorProductCode: line.vendorProductCode ?? null,
        productDescription: line.productDescription,
        quantityOrdered: String(line.quantityOrdered),
        quantityReceived: '0.0000',
        quantityBilled: '0.0000',
        unitPriceNet: String(line.unitPriceNet),
        taxRatePercent: String(line.taxRatePercent ?? 23),
        subtotalNet: calc.subtotalNet,
        totalTax: calc.totalTax,
        totalGross: calc.totalGross,
        expectedDeliveryDate: line.expectedDeliveryDate ? new Date(line.expectedDeliveryDate) : null,
        sortOrder: line.sortOrder ?? idx,
        createdAt: now,
        updatedAt: now,
      })
    })

    const totals = this.calculationService.calculateTotals(
      calculatedLines.map((l) => ({
        quantityOrdered: l.quantityOrdered,
        unitPriceNet: l.unitPriceNet,
        taxRatePercent: l.taxRatePercent,
      }))
    )

    order.subtotalNet = totals.subtotalNet
    order.totalTax = totals.totalTax
    order.totalGross = totals.totalGross

    await this.em.persist([order, ...calculatedLines]).flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.order.created', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        vendorId: order.vendorId,
        totalGross: order.totalGross,
      })
    }

    return order
  }

  async updateOrder(
    orderId: string,
    scope: Scope,
    input: PurchaseOrderUpdateInput
  ): Promise<PurchaseOrder> {
    const order = await this.em.findOneOrFail(PurchaseOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, { populate: ['lines'] })

    if (order.status === 'locked' || order.status === 'cancelled') {
      throw new Error(`Cannot modify order in ${order.status} state`)
    }

    const now = new Date()

    if (input.vendorId !== undefined) order.vendorId = input.vendorId
    if (input.vendorName !== undefined) order.vendorName = input.vendorName
    if (input.buyerId !== undefined) order.buyerId = input.buyerId
    if (input.orderDate !== undefined) order.orderDate = new Date(input.orderDate)
    if (input.expectedArrivalDate !== undefined) {
      order.expectedArrivalDate = input.expectedArrivalDate ? new Date(input.expectedArrivalDate) : null
    }
    if (input.currencyCode !== undefined) order.currencyCode = input.currencyCode
    if (input.exchangeRate !== undefined) order.exchangeRate = String(input.exchangeRate)
    if (input.paymentTermId !== undefined) order.paymentTermId = input.paymentTermId
    if (input.incoterm !== undefined) order.incoterm = input.incoterm
    if (input.controlPolicy !== undefined) order.controlPolicy = input.controlPolicy
    if (input.notes !== undefined) order.notes = input.notes

    if (input.lines) {
      // Clear existing lines and replace with updated ones
      for (const existingLine of order.lines.getItems()) {
        existingLine.deletedAt = now
      }

      const newLines = input.lines.map((line, idx) => {
        const calc = this.calculationService.calculateLine({
          quantityOrdered: line.quantityOrdered,
          unitPriceNet: line.unitPriceNet,
          taxRatePercent: line.taxRatePercent ?? 23,
        })

        return this.em.create(PurchaseOrderLine, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          purchaseOrder: order,
          productId: line.productId ?? null,
          vendorProductCode: line.vendorProductCode ?? null,
          productDescription: line.productDescription,
          quantityOrdered: String(line.quantityOrdered),
          quantityReceived: '0.0000',
          quantityBilled: '0.0000',
          unitPriceNet: String(line.unitPriceNet),
          taxRatePercent: String(line.taxRatePercent ?? 23),
          subtotalNet: calc.subtotalNet,
          totalTax: calc.totalTax,
          totalGross: calc.totalGross,
          expectedDeliveryDate: line.expectedDeliveryDate ? new Date(line.expectedDeliveryDate) : null,
          sortOrder: line.sortOrder ?? idx,
          createdAt: now,
          updatedAt: now,
        })
      })

      const totals = this.calculationService.calculateTotals(
        newLines.map((l) => ({
          quantityOrdered: l.quantityOrdered,
          unitPriceNet: l.unitPriceNet,
          taxRatePercent: l.taxRatePercent,
        }))
      )

      order.subtotalNet = totals.subtotalNet
      order.totalTax = totals.totalTax
      order.totalGross = totals.totalGross

      this.em.persist(newLines)
    }

    order.updatedAt = now
    await this.em.flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.order.updated', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        totalGross: order.totalGross,
      })
    }

    return order
  }

  async sendRfq(orderId: string, scope: Scope): Promise<PurchaseOrder> {
    const order = await this.em.findOneOrFail(PurchaseOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    if (order.status !== 'draft_rfq') {
      throw new Error(`Can only send RFQ from draft_rfq status (current: ${order.status})`)
    }

    order.status = 'rfq_sent'
    order.updatedAt = new Date()
    await this.em.flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.order.sent', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }

    return order
  }

  async confirmOrder(orderId: string, scope: Scope): Promise<PurchaseOrder> {
    const order = await this.em.findOneOrFail(PurchaseOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    if (order.status !== 'draft_rfq' && order.status !== 'rfq_sent') {
      throw new Error(`Cannot confirm order in status: ${order.status}`)
    }

    const settings = await this.getSettings(scope)
    const grossAmount = Number(order.totalGross)
    const thresholdAmount = Number(settings.approvalThresholdAmount)

    // Check if double validation / manager approval is required
    const requiresApproval =
      settings.doubleValidationEnabled &&
      grossAmount > thresholdAmount

    const now = new Date()

    if (requiresApproval) {
      order.status = 'to_approve'
      order.approvalStatus = 'pending'
    } else {
      order.status = 'purchase_order'
      order.approvalStatus = 'approved'
      // If it has an RFQ sequence number, upgrade to PO number
      if (order.orderNumber.startsWith('RFQ/')) {
        order.orderNumber = await this.numberGenerator.generateNumber('po', scope)
      }
    }

    order.updatedAt = now
    await this.em.flush()

    if (order.status === 'purchase_order' && settings.autoCreateReceiptOnConfirm && this.receiptService) {
      await this.receiptService.createReceiptForOrder(order.id, scope)
    }

    if (this.eventBus) {
      if (order.status === 'purchase_order') {
        await this.eventBus.emit('purchases.order.confirmed', {
          orderId: order.id,
          orderNumber: order.orderNumber,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          vendorId: order.vendorId,
          totalGross: order.totalGross,
        })
      }
    }

    return order
  }

  async approveOrder(orderId: string, scope: Scope): Promise<PurchaseOrder> {
    const order = await this.em.findOneOrFail(PurchaseOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    if (order.status !== 'to_approve') {
      throw new Error(`Can only approve order in to_approve status (current: ${order.status})`)
    }

    const now = new Date()
    const settings = await this.getSettings(scope)
    order.status = 'purchase_order'
    order.approvalStatus = 'approved'
    if (order.orderNumber.startsWith('RFQ/')) {
      order.orderNumber = await this.numberGenerator.generateNumber('po', scope)
    }
    order.updatedAt = now
    await this.em.flush()

    if (order.status === 'purchase_order' && settings.autoCreateReceiptOnConfirm && this.receiptService) {
      await this.receiptService.createReceiptForOrder(order.id, scope)
    }

    if (this.eventBus) {
      await this.eventBus.emit('purchases.order.approved', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      await this.eventBus.emit('purchases.order.confirmed', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        vendorId: order.vendorId,
        totalGross: order.totalGross,
      })
    }

    return order
  }

  async cancelOrder(orderId: string, scope: Scope): Promise<PurchaseOrder> {
    const order = await this.em.findOneOrFail(PurchaseOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    if (order.status === 'locked') {
      throw new Error('Cannot cancel a locked purchase order')
    }

    if (Number(order.deliveryStatus !== 'pending')) {
      throw new Error('Cannot cancel order that has already received deliveries')
    }

    order.status = 'cancelled'
    order.updatedAt = new Date()
    await this.em.flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.order.cancelled', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }

    return order
  }
}
