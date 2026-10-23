import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import {
  PurchaseBill,
  PurchaseBillLine,
  PurchaseOrder,
  PurchaseOrderLine,
  type PurchaseBillStatus,
  type PurchaseBillMatchingStatus,
} from '../data/entities'
import type { PurchaseBillCreateInput } from '../data/validators'

type Scope = {
  organizationId: string
  tenantId: string
}

export type MatchVerificationResult = {
  verified: boolean
  matchingStatus: PurchaseBillMatchingStatus
  exceptions: string[]
  bill: PurchaseBill
}

export class ThreeWayMatchService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventBus?: EventBus | null
  ) {}

  async createBill(
    input: PurchaseBillCreateInput,
    scope: Scope
  ): Promise<PurchaseBill> {
    const order = await this.em.findOneOrFail(
      PurchaseOrder,
      {
        id: input.purchaseOrderId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      { populate: ['lines'] }
    )

    const now = new Date()
    const billDate = input.billDate ? new Date(input.billDate) : now

    let totalNetNum = 0

    const bill = this.em.create(PurchaseBill, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      purchaseOrder: order,
      vendorBillNumber: input.vendorBillNumber,
      billDate,
      status: 'draft',
      matchingStatus: 'pending',
      exceptionNotes: null,
      totalNet: '0.0000',
      totalGross: '0.0000',
      createdAt: now,
      updatedAt: now,
    })

    for (const lineInput of input.lines) {
      const lineNet = Number(lineInput.quantity) * Number(lineInput.unitPriceNet)
      totalNetNum += lineNet

      this.em.create(PurchaseBillLine, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        bill,
        orderLineId: lineInput.orderLineId ?? null,
        productId: lineInput.productId ?? null,
        productDescription: lineInput.productDescription,
        quantity: Number(lineInput.quantity).toFixed(4),
        unitPriceNet: Number(lineInput.unitPriceNet).toFixed(4),
        subtotalNet: lineNet.toFixed(4),
        createdAt: now,
        updatedAt: now,
      })
    }

    bill.totalNet = totalNetNum.toFixed(4)
    // Approximate gross assuming average 23% or standard tax
    bill.totalGross = (totalNetNum * 1.23).toFixed(4)

    await this.em.persist(bill).flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.bill.created', {
        billId: bill.id,
        purchaseOrderId: order.id,
        vendorBillNumber: bill.vendorBillNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }

    return bill
  }

  async verifyMatch(
    billId: string,
    scope: Scope
  ): Promise<MatchVerificationResult> {
    const bill = await this.em.findOneOrFail(
      PurchaseBill,
      {
        id: billId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      { populate: ['lines', 'purchaseOrder', 'purchaseOrder.lines'] }
    )

    const order = bill.purchaseOrder
    const orderLines = order.lines.getItems()
    const billLines = bill.lines.getItems()

    const exceptions: string[] = []

    for (const bLine of billLines) {
      // Find matching PO line
      let matchedPoLine: PurchaseOrderLine | undefined
      if (bLine.orderLineId) {
        matchedPoLine = orderLines.find((pol) => pol.id === bLine.orderLineId)
      }
      if (!matchedPoLine && bLine.productId) {
        matchedPoLine = orderLines.find((pol) => pol.productId === bLine.productId)
      }

      if (!matchedPoLine) {
        exceptions.push(
          `Line "${bLine.productDescription}": no corresponding purchase order line found.`
        )
        continue
      }

      // 1. Verify Unit Price
      const poPrice = Number(matchedPoLine.unitPriceNet)
      const billPrice = Number(bLine.unitPriceNet)
      if (Math.abs(poPrice - billPrice) > 0.0001) {
        exceptions.push(
          `Price mismatch on "${bLine.productDescription}": PO price is ${poPrice.toFixed(
            4
          )}, but bill price is ${billPrice.toFixed(4)}.`
        )
      }

      // 2. Verify Quantity against Control Policy
      const billQty = Number(bLine.quantity)
      const orderedQty = Number(matchedPoLine.quantityOrdered)
      const receivedQty = Number(matchedPoLine.quantityReceived)
      const previouslyBilledQty = Number(matchedPoLine.quantityBilled)

      if (order.controlPolicy === 'on_received') {
        const maxAllowed = receivedQty - previouslyBilledQty
        if (billQty > maxAllowed + 0.0001) {
          exceptions.push(
            `Quantity mismatch on "${bLine.productDescription}": billed quantity (${billQty}) exceeds available received quantity (${receivedQty} received, ${previouslyBilledQty} already billed).`
          )
        }
      } else {
        // on_ordered
        const maxAllowed = orderedQty - previouslyBilledQty
        if (billQty > maxAllowed + 0.0001) {
          exceptions.push(
            `Quantity mismatch on "${bLine.productDescription}": billed quantity (${billQty}) exceeds ordered quantity (${orderedQty} ordered, ${previouslyBilledQty} already billed).`
          )
        }
      }
    }

    const now = new Date()
    bill.updatedAt = now

    if (exceptions.length > 0) {
      bill.matchingStatus = 'exception'
      bill.exceptionNotes = exceptions.join('\n')
      await this.em.flush()

      if (this.eventBus) {
        await this.eventBus.emit('purchases.bill.matched', {
          billId: bill.id,
          purchaseOrderId: order.id,
          status: 'exception',
          exceptions,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        })
      }

      return {
        verified: false,
        matchingStatus: 'exception',
        exceptions,
        bill,
      }
    }

    // Matching verified! Post bill and update order line billed quantities
    bill.matchingStatus = 'verified'
    bill.status = 'posted'
    bill.exceptionNotes = null

    for (const bLine of billLines) {
      let matchedPoLine: PurchaseOrderLine | undefined
      if (bLine.orderLineId) {
        matchedPoLine = orderLines.find((pol) => pol.id === bLine.orderLineId)
      }
      if (!matchedPoLine && bLine.productId) {
        matchedPoLine = orderLines.find((pol) => pol.productId === bLine.productId)
      }

      if (matchedPoLine) {
        const newBilled = Number(matchedPoLine.quantityBilled) + Number(bLine.quantity)
        matchedPoLine.quantityBilled = newBilled.toFixed(4)
        matchedPoLine.updatedAt = now
      }
    }

    // Update overall purchase order invoice status
    const allOrderedFullyBilled = orderLines.every(
      (line) => Number(line.quantityBilled) >= Number(line.quantityOrdered) - 0.0001
    )
    const anyBilled = orderLines.some((line) => Number(line.quantityBilled) > 0)

    if (allOrderedFullyBilled) {
      order.invoiceStatus = 'invoiced'
    } else if (anyBilled) {
      order.invoiceStatus = 'to_invoice'
    }
    order.updatedAt = now

    await this.em.flush()

    if (this.eventBus) {
      await this.eventBus.emit('purchases.bill.matched', {
        billId: bill.id,
        purchaseOrderId: order.id,
        status: 'verified',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }

    return {
      verified: true,
      matchingStatus: 'verified',
      exceptions: [],
      bill,
    }
  }
}
