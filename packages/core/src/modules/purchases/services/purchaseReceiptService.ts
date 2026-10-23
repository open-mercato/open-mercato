import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseReceipt,
  PurchaseReceiptLine,
} from '../data/entities'
import type { PurchaseDocumentNumberGenerator } from './purchaseDocumentNumberGenerator'
import type { ValidateReceiptInput } from '../data/validators'

type Scope = {
  organizationId: string
  tenantId: string
}

export class PurchaseReceiptService {
  constructor(
    private readonly em: EntityManager,
    private readonly numberGenerator: PurchaseDocumentNumberGenerator,
    private readonly eventBus?: EventBus | null
  ) {}

  async createReceiptForOrder(
    orderId: string,
    scope: Scope,
    warehouseId?: string | null
  ): Promise<PurchaseReceipt> {
    const order = await this.em.findOneOrFail(
      PurchaseOrder,
      { id: orderId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      { populate: ['lines'] }
    )

    const receiptNumber = await this.numberGenerator.generateNumber('pz', scope)
    const now = new Date()

    const receipt = this.em.create(PurchaseReceipt, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      purchaseOrder: order,
      receiptNumber,
      status: 'ready',
      warehouseId: warehouseId ?? null,
      isBackorder: false,
      backorderOfId: null,
      createdAt: now,
      updatedAt: now,
    })

    const lines = order.lines.getItems().map((orderLine) =>
      this.em.create(PurchaseReceiptLine, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        receipt,
        orderLineId: orderLine.id,
        productId: orderLine.productId ?? null,
        productDescription: orderLine.productDescription,
        quantityExpected: String(orderLine.quantityOrdered),
        quantityDone: '0.0000',
        createdAt: now,
        updatedAt: now,
      })
    )

    await this.em.persist([receipt, ...lines]).flush()
    return receipt
  }

  async validateReceipt(
    receiptId: string,
    scope: Scope,
    input: ValidateReceiptInput
  ): Promise<{ receipt: PurchaseReceipt; backorder?: PurchaseReceipt | null }> {
    const receipt = await this.em.findOneOrFail(
      PurchaseReceipt,
      { id: receiptId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      { populate: ['lines', 'purchaseOrder.lines'] }
    )

    if (receipt.status === 'done' || receipt.status === 'cancelled') {
      throw new Error(`Receipt cannot be validated in status: ${receipt.status}`)
    }

    const now = new Date()
    const doneMap = new Map<string, number>()
    for (const l of input.lines) {
      doneMap.set(l.orderLineId, Number(l.quantityDone))
    }

    const backorderLinesToCreate: Array<{
      orderLineId: string
      productId: string | null
      productDescription: string
      quantityRemaining: number
    }> = []

    for (const line of receipt.lines.getItems()) {
      const quantityDone = doneMap.get(line.orderLineId) ?? Number(line.quantityExpected)
      const expected = Number(line.quantityExpected)
      line.quantityDone = String(quantityDone)
      line.updatedAt = now

      // Update matching order line's quantityReceived
      const orderLine = receipt.purchaseOrder.lines.getItems().find((ol) => ol.id === line.orderLineId)
      if (orderLine) {
        const prevReceived = Number(orderLine.quantityReceived)
        orderLine.quantityReceived = (prevReceived + quantityDone).toFixed(4)
        orderLine.updatedAt = now
      }

      // Check if partial
      if (quantityDone < expected) {
        backorderLinesToCreate.push({
          orderLineId: line.orderLineId,
          productId: line.productId ?? null,
          productDescription: line.productDescription,
          quantityRemaining: expected - quantityDone,
        })
      }
    }

    receipt.status = 'done'
    receipt.receivedDate = now
    receipt.updatedAt = now

    let backorderReceipt: PurchaseReceipt | null = null

    // Create backorder if requested and items remained
    if (input.createBackorder && backorderLinesToCreate.length > 0) {
      const backorderNumber = await this.numberGenerator.generateNumber('pz', scope)
      backorderReceipt = this.em.create(PurchaseReceipt, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        purchaseOrder: receipt.purchaseOrder,
        receiptNumber: backorderNumber,
        status: 'ready',
        warehouseId: receipt.warehouseId,
        isBackorder: true,
        backorderOfId: receipt.id,
        notes: `Backorder spawned from ${receipt.receiptNumber}`,
        createdAt: now,
        updatedAt: now,
      })

      const boLines = backorderLinesToCreate.map((bo) =>
        this.em.create(PurchaseReceiptLine, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          receipt: backorderReceipt!,
          orderLineId: bo.orderLineId,
          productId: bo.productId,
          productDescription: bo.productDescription,
          quantityExpected: bo.quantityRemaining.toFixed(4),
          quantityDone: '0.0000',
          createdAt: now,
          updatedAt: now,
        })
      )

      this.em.persist([backorderReceipt, ...boLines])
    }

    // Recalculate order delivery status
    let totalOrdered = 0
    let totalReceived = 0
    for (const ol of receipt.purchaseOrder.lines.getItems()) {
      totalOrdered += Number(ol.quantityOrdered)
      totalReceived += Number(ol.quantityReceived)
    }

    if (totalReceived >= totalOrdered) {
      receipt.purchaseOrder.deliveryStatus = 'fully_received'
    } else if (totalReceived > 0) {
      receipt.purchaseOrder.deliveryStatus = 'partially_received'
    } else {
      receipt.purchaseOrder.deliveryStatus = 'pending'
    }
    receipt.purchaseOrder.updatedAt = now

    await this.em.flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.receipt.validated', {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        orderId: receipt.purchaseOrder.id,
        orderNumber: receipt.purchaseOrder.orderNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        isBackorder: receipt.isBackorder,
        hasSpawnedBackorder: Boolean(backorderReceipt),
      })
    }

    return { receipt, backorder: backorderReceipt }
  }
}
