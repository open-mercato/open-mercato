import type { EntityManager } from '@mikro-orm/postgresql'
import {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseReceipt,
  PurchaseReceiptLine,
  PurchaseBill,
  PurchaseBillLine,
  VendorPricelist,
  VendorPricelistItem,
  ReorderingRule,
  PurchaseVendor,
} from '../data/entities'

type SeedScope = {
  tenantId: string
  organizationId: string
}

export async function seedPurchaseExamples(
  em: EntityManager,
  scope: SeedScope
): Promise<void> {
  const existingOrder = await em.findOne(PurchaseOrder, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  if (existingOrder) {
    // Already seeded
    return
  }

  const now = new Date()

  // Find or fallback vendor ID
  const vendorId = '9911d342-b946-45eb-a9bc-dad146547c38'
  const secondVendorId = 'dd302b24-c8df-4a09-b1d5-0c0431503d7b'

  // Products
  const prodRunnerId = 'ce041b54-50cd-4700-864f-5c59624aec9e'
  const prodDressId = '627740b2-ba6d-4fc5-839a-9cd21d0e918a'

  // 0. Vendors
  em.create(PurchaseVendor, {
    id: vendorId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name: 'Nordic Wholesale Supplier Ltd',
    code: 'VEND-NORDIC',
    email: 'orders@nordicwholesale.example.com',
    phone: '+48 22 100 2000',
    currencyCode: 'PLN',
    paymentTerms: 'Net 30',
    taxId: 'PL5250001234',
    address: 'ul. Magazynowa 15, 02-677 Warszawa',
    notes: 'Primary supplier for standard product line',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  em.create(PurchaseVendor, {
    id: secondVendorId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name: 'Global Apparel Distribution GmbH',
    code: 'VEND-GLOBAL',
    email: 'b2b@globalapparel.example.de',
    phone: '+49 30 98765432',
    currencyCode: 'EUR',
    paymentTerms: 'Net 14',
    taxId: 'DE987654321',
    address: 'Industriestrasse 42, 10115 Berlin',
    notes: 'International apparel and fabrics distributor',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  // 1. Vendor Pricelist with Volume Discounts
  const pricelist = em.create(VendorPricelist, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    vendorId,
    name: 'Nordic Wholesale Supplier Standard 2026',
    currencyCode: 'PLN',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  em.create(VendorPricelistItem, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    pricelist,
    productId: prodRunnerId,
    vendorProductCode: 'NORD-SNEAK-01',
    minQuantity: '1.0000',
    price: '180.0000',
    leadTimeDays: 7,
    createdAt: now,
    updatedAt: now,
  })

  em.create(VendorPricelistItem, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    pricelist,
    productId: prodRunnerId,
    vendorProductCode: 'NORD-SNEAK-01-BULK',
    minQuantity: '20.0000',
    price: '145.0000', // Volume discount
    leadTimeDays: 5,
    createdAt: now,
    updatedAt: now,
  })

  em.create(VendorPricelistItem, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    pricelist,
    productId: prodDressId,
    vendorProductCode: 'NORD-DRESS-A',
    minQuantity: '1.0000',
    price: '95.0000',
    leadTimeDays: 4,
    createdAt: now,
    updatedAt: now,
  })

  // 2. Draft RFQ: RFQ/2026/0001
  const rfq1 = em.create(PurchaseOrder, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    orderNumber: 'RFQ/2026/0001',
    status: 'draft_rfq',
    vendorId,
    vendorName: 'Nordic Wholesale Supplier Ltd',
    orderDate: now,
    expectedArrivalDate: new Date(Date.now() + 7 * 86400000),
    currencyCode: 'PLN',
    exchangeRate: '1.000000',
    subtotalNet: '3600.0000',
    totalTax: '828.0000',
    totalGross: '4428.0000',
    controlPolicy: 'on_received',
    approvalStatus: 'not_required',
    invoiceStatus: 'no',
    deliveryStatus: 'pending',
    notes: 'Draft quotation request for spring restock.',
    createdAt: now,
    updatedAt: now,
  })

  em.create(PurchaseOrderLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: rfq1,
    productId: prodRunnerId,
    vendorProductCode: 'NORD-SNEAK-01-BULK',
    productDescription: 'Atlas Runner Sneaker (Size 42)',
    quantityOrdered: '20.0000',
    quantityReceived: '0.0000',
    quantityBilled: '0.0000',
    unitPriceNet: '145.0000',
    taxRatePercent: '23.00',
    subtotalNet: '2900.0000',
    totalTax: '667.0000',
    totalGross: '3567.0000',
    createdAt: now,
    updatedAt: now,
  })

  em.create(PurchaseOrderLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: rfq1,
    productId: prodDressId,
    vendorProductCode: 'NORD-DRESS-A',
    productDescription: 'Aurora Wrap Dress (Midnight Blue)',
    quantityOrdered: '7.0000',
    quantityReceived: '0.0000',
    quantityBilled: '0.0000',
    unitPriceNet: '100.0000',
    taxRatePercent: '23.00',
    subtotalNet: '700.0000',
    totalTax: '161.0000',
    totalGross: '861.0000',
    createdAt: now,
    updatedAt: now,
  })

  // 3. Sent RFQ: RFQ/2026/0002
  const rfq2 = em.create(PurchaseOrder, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    orderNumber: 'RFQ/2026/0002',
    status: 'rfq_sent',
    vendorId: secondVendorId,
    vendorName: 'Global Apparel Distribution GmbH',
    orderDate: new Date(Date.now() - 2 * 86400000),
    expectedArrivalDate: new Date(Date.now() + 10 * 86400000),
    currencyCode: 'PLN',
    exchangeRate: '1.000000',
    subtotalNet: '4750.0000',
    totalTax: '1092.5000',
    totalGross: '5842.5000',
    controlPolicy: 'on_received',
    approvalStatus: 'not_required',
    invoiceStatus: 'no',
    deliveryStatus: 'pending',
    notes: 'Sent to supplier, awaiting commercial confirmation.',
    createdAt: new Date(Date.now() - 2 * 86400000),
    updatedAt: now,
  })

  em.create(PurchaseOrderLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: rfq2,
    productId: prodDressId,
    vendorProductCode: 'GAD-WRAP-99',
    productDescription: 'Aurora Wrap Dress (Emerald Green)',
    quantityOrdered: '50.0000',
    quantityReceived: '0.0000',
    quantityBilled: '0.0000',
    unitPriceNet: '95.0000',
    taxRatePercent: '23.00',
    subtotalNet: '4750.0000',
    totalTax: '1092.5000',
    totalGross: '5842.5000',
    createdAt: new Date(Date.now() - 2 * 86400000),
    updatedAt: now,
  })

  // 4. Confirmed Purchase Order with Goods Receipt (PZ): PO/2026/0001
  const po1 = em.create(PurchaseOrder, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    orderNumber: 'PO/2026/0001',
    status: 'purchase_order',
    vendorId,
    vendorName: 'Nordic Wholesale Supplier Ltd',
    orderDate: new Date(Date.now() - 5 * 86400000),
    expectedArrivalDate: new Date(Date.now() + 2 * 86400000),
    currencyCode: 'PLN',
    exchangeRate: '1.000000',
    subtotalNet: '7250.0000',
    totalTax: '1667.5000',
    totalGross: '8917.5000',
    controlPolicy: 'on_received',
    approvalStatus: 'approved',
    invoiceStatus: 'invoiced',
    deliveryStatus: 'fully_received',
    notes: 'Confirmed and delivered stock.',
    createdAt: new Date(Date.now() - 5 * 86400000),
    updatedAt: now,
  })

  const poLine1 = em.create(PurchaseOrderLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po1,
    productId: prodRunnerId,
    vendorProductCode: 'NORD-SNEAK-01-BULK',
    productDescription: 'Atlas Runner Sneaker (Batch A)',
    quantityOrdered: '50.0000',
    quantityReceived: '50.0000',
    quantityBilled: '50.0000',
    unitPriceNet: '145.0000',
    taxRatePercent: '23.00',
    subtotalNet: '7250.0000',
    totalTax: '1667.5000',
    totalGross: '8917.5000',
    createdAt: new Date(Date.now() - 5 * 86400000),
    updatedAt: now,
  })

  // Goods Receipt for PO/2026/0001
  const receipt1 = em.create(PurchaseReceipt, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po1,
    receiptNumber: 'PZ/2026/0001',
    status: 'done',
    isBackorder: false,
    receivedDate: new Date(Date.now() - 2 * 86400000),
    notes: 'Shipment arrived intact, barcode verified.',
    createdAt: new Date(Date.now() - 5 * 86400000),
    updatedAt: now,
  })

  em.create(PurchaseReceiptLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    receipt: receipt1,
    orderLineId: poLine1.id,
    productId: prodRunnerId,
    productDescription: 'Atlas Runner Sneaker (Batch A)',
    quantityExpected: '50.0000',
    quantityDone: '50.0000',
    createdAt: new Date(Date.now() - 5 * 86400000),
    updatedAt: now,
  })

  // Verified 3-Way Match Vendor Bill for PO/2026/0001
  const bill1 = em.create(PurchaseBill, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po1,
    vendorBillNumber: 'INV/NORDIC/2026/8891',
    billDate: new Date(Date.now() - 1 * 86400000),
    status: 'posted',
    matchingStatus: 'verified',
    exceptionNotes: null,
    totalNet: '7250.0000',
    totalGross: '8917.5000',
    createdAt: new Date(Date.now() - 1 * 86400000),
    updatedAt: now,
  })

  em.create(PurchaseBillLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    bill: bill1,
    orderLineId: poLine1.id,
    productId: prodRunnerId,
    productDescription: 'Atlas Runner Sneaker (Batch A)',
    quantity: '50.0000',
    unitPriceNet: '145.0000',
    subtotalNet: '7250.0000',
    createdAt: new Date(Date.now() - 1 * 86400000),
    updatedAt: now,
  })

  // 5. Partial Delivery with Backorder: PO/2026/0002
  const po2 = em.create(PurchaseOrder, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    orderNumber: 'PO/2026/0002',
    status: 'purchase_order',
    vendorId,
    vendorName: 'Nordic Wholesale Supplier Ltd',
    orderDate: new Date(Date.now() - 3 * 86400000),
    expectedArrivalDate: new Date(Date.now() + 3 * 86400000),
    currencyCode: 'PLN',
    exchangeRate: '1.000000',
    subtotalNet: '9500.0000',
    totalTax: '2185.0000',
    totalGross: '11685.0000',
    controlPolicy: 'on_received',
    approvalStatus: 'approved',
    invoiceStatus: 'to_invoice',
    deliveryStatus: 'partially_received',
    notes: 'Partial shipment received; backorder generated for remainder.',
    createdAt: new Date(Date.now() - 3 * 86400000),
    updatedAt: now,
  })

  const poLine2 = em.create(PurchaseOrderLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po2,
    productId: prodDressId,
    vendorProductCode: 'NORD-DRESS-A',
    productDescription: 'Aurora Wrap Dress (Silk Blend)',
    quantityOrdered: '100.0000',
    quantityReceived: '70.0000',
    quantityBilled: '0.0000',
    unitPriceNet: '95.0000',
    taxRatePercent: '23.00',
    subtotalNet: '9500.0000',
    totalTax: '2185.0000',
    totalGross: '11685.0000',
    createdAt: new Date(Date.now() - 3 * 86400000),
    updatedAt: now,
  })

  // Initial PZ (70 units validated)
  const receipt2 = em.create(PurchaseReceipt, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po2,
    receiptNumber: 'PZ/2026/0002',
    status: 'done',
    isBackorder: false,
    receivedDate: new Date(Date.now() - 1 * 86400000),
    notes: 'First batch: 70 units arrived.',
    createdAt: new Date(Date.now() - 3 * 86400000),
    updatedAt: now,
  })

  em.create(PurchaseReceiptLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    receipt: receipt2,
    orderLineId: poLine2.id,
    productId: prodDressId,
    productDescription: 'Aurora Wrap Dress (Silk Blend)',
    quantityExpected: '100.0000',
    quantityDone: '70.0000',
    createdAt: new Date(Date.now() - 3 * 86400000),
    updatedAt: now,
  })

  // Spawned Backorder PZ (30 units open)
  const backorderReceipt = em.create(PurchaseReceipt, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po2,
    receiptNumber: 'PZ/2026/0003',
    status: 'ready',
    isBackorder: true,
    backorderOfId: receipt2.id,
    notes: 'Backorder for remaining 30 units from PO/2026/0002.',
    createdAt: new Date(Date.now() - 1 * 86400000),
    updatedAt: now,
  })

  em.create(PurchaseReceiptLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    receipt: backorderReceipt,
    orderLineId: poLine2.id,
    productId: prodDressId,
    productDescription: 'Aurora Wrap Dress (Silk Blend)',
    quantityExpected: '30.0000',
    quantityDone: '0.0000',
    createdAt: new Date(Date.now() - 1 * 86400000),
    updatedAt: now,
  })

  // 6. Vendor Bill with Exception (Price Discrepancy)
  const bill2 = em.create(PurchaseBill, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    purchaseOrder: po2,
    vendorBillNumber: 'INV/NORDIC/2026/9102',
    billDate: now,
    status: 'draft',
    matchingStatus: 'exception',
    exceptionNotes:
      'Price mismatch on "Aurora Wrap Dress (Silk Blend)": PO price is 95.0000, but bill price is 110.0000.\nRequires supplier reconciliation.',
    totalNet: '7700.0000',
    totalGross: '9471.0000',
    createdAt: now,
    updatedAt: now,
  })

  em.create(PurchaseBillLine, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    bill: bill2,
    orderLineId: poLine2.id,
    productId: prodDressId,
    productDescription: 'Aurora Wrap Dress (Silk Blend)',
    quantity: '70.0000',
    unitPriceNet: '110.0000', // Surcharged by supplier!
    subtotalNet: '7700.0000',
    createdAt: now,
    updatedAt: now,
  })

  // 7. Reordering Rules (Min-Max)
  em.create(ReorderingRule, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    productId: prodRunnerId,
    minQuantity: '20.0000',
    maxQuantity: '100.0000',
    quantityMultiple: '10.0000',
    preferredVendorId: vendorId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  em.create(ReorderingRule, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    productId: prodDressId,
    minQuantity: '15.0000',
    maxQuantity: '60.0000',
    quantityMultiple: '5.0000',
    preferredVendorId: secondVendorId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  await em.flush()
}
