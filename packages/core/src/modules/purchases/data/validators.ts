import { z } from 'zod'

export const purchaseOrderLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().nullable().optional(),
  vendorProductCode: z.string().max(100).nullable().optional(),
  productDescription: z.string().min(1, 'Product description is required').max(500),
  quantityOrdered: z.coerce.number().positive('Quantity must be greater than 0'),
  unitPriceNet: z.coerce.number().min(0, 'Unit price cannot be negative'),
  taxRatePercent: z.coerce.number().min(0).max(100).default(23),
  expectedDeliveryDate: z.string().datetime().nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
})

export const purchaseOrderCreateSchema = z.object({
  vendorId: z.string().uuid('Vendor ID must be a valid UUID'),
  vendorName: z.string().max(255).nullable().optional(),
  buyerId: z.string().uuid().nullable().optional(),
  orderDate: z.string().datetime().optional(),
  expectedArrivalDate: z.string().datetime().nullable().optional(),
  currencyCode: z.string().min(3).max(3).default('PLN'),
  exchangeRate: z.coerce.number().positive().default(1.0),
  paymentTermId: z.string().uuid().nullable().optional(),
  incoterm: z.string().max(20).nullable().optional(),
  controlPolicy: z.enum(['on_received', 'on_ordered']).default('on_received'),
  notes: z.string().max(5000).nullable().optional(),
  lines: z.array(purchaseOrderLineInputSchema).optional().default([]),
})

export const purchaseOrderUpdateSchema = z.object({
  vendorId: z.string().uuid().optional(),
  vendorName: z.string().max(255).nullable().optional(),
  buyerId: z.string().uuid().nullable().optional(),
  orderDate: z.string().datetime().optional(),
  expectedArrivalDate: z.string().datetime().nullable().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  paymentTermId: z.string().uuid().nullable().optional(),
  incoterm: z.string().max(20).nullable().optional(),
  controlPolicy: z.enum(['on_received', 'on_ordered']).optional(),
  notes: z.string().max(5000).nullable().optional(),
  lines: z.array(purchaseOrderLineInputSchema).optional(),
})

export const purchaseSettingsUpdateSchema = z.object({
  approvalThresholdAmount: z.coerce.number().min(0),
  approvalThresholdCurrency: z.string().min(3).max(3),
  doubleValidationEnabled: z.boolean(),
  defaultControlPolicy: z.enum(['on_received', 'on_ordered']),
  autoCreateReceiptOnConfirm: z.boolean(),
})

// Phase 2: Vendor Pricelist Validators
export const vendorPricelistItemSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid('Product ID must be a valid UUID'),
  vendorProductCode: z.string().max(100).nullable().optional(),
  minQuantity: z.coerce.number().positive().default(1),
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  leadTimeDays: z.coerce.number().int().min(0).default(0),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
})

export const vendorPricelistCreateSchema = z.object({
  vendorId: z.string().uuid('Vendor ID must be a valid UUID'),
  name: z.string().min(1, 'Name is required').max(200),
  currencyCode: z.string().min(3).max(3).default('PLN'),
  isActive: z.boolean().default(true),
  items: z.array(vendorPricelistItemSchema).optional().default([]),
})

export const vendorPricelistUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  isActive: z.boolean().optional(),
  items: z.array(vendorPricelistItemSchema).optional(),
})

// Phase 2: Goods Receipt (PZ) Validation
export const validateReceiptLineSchema = z.object({
  orderLineId: z.string().uuid(),
  quantityDone: z.coerce.number().min(0),
})

export const validateReceiptSchema = z.object({
  lines: z.array(validateReceiptLineSchema),
  createBackorder: z.boolean().default(true),
})

export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>
export type PurchaseSettingsUpdateInput = z.infer<typeof purchaseSettingsUpdateSchema>
export type VendorPricelistCreateInput = z.infer<typeof vendorPricelistCreateSchema>
export type VendorPricelistUpdateInput = z.infer<typeof vendorPricelistUpdateSchema>
export type VendorPricelistItemInput = z.infer<typeof vendorPricelistItemSchema>
export type ValidateReceiptInput = z.infer<typeof validateReceiptSchema>

// Phase 3: Vendor Bills & 3-Way Match
export const purchaseBillLineSchema = z.object({
  id: z.string().uuid().optional(),
  orderLineId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  productDescription: z.string().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().positive('Quantity must be positive'),
  unitPriceNet: z.coerce.number().min(0, 'Unit price cannot be negative'),
})

export const purchaseBillCreateSchema = z.object({
  purchaseOrderId: z.string().uuid('Purchase Order ID is required'),
  vendorBillNumber: z.string().min(1, 'Vendor bill number is required').max(100),
  billDate: z.string().datetime().optional(),
  lines: z.array(purchaseBillLineSchema).min(1, 'At least one line item is required'),
})

// Phase 3: Reordering Rules (Min-Max)
export const reorderingRuleCreateSchema = z.object({
  productId: z.string().uuid('Product ID is required'),
  warehouseId: z.string().uuid().nullable().optional(),
  minQuantity: z.coerce.number().min(0, 'Min quantity cannot be negative'),
  maxQuantity: z.coerce.number().min(0, 'Max quantity cannot be negative'),
  quantityMultiple: z.coerce.number().positive().default(1),
  preferredVendorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
})

export const reorderingRuleUpdateSchema = z.object({
  warehouseId: z.string().uuid().nullable().optional(),
  minQuantity: z.coerce.number().min(0).optional(),
  maxQuantity: z.coerce.number().min(0).optional(),
  quantityMultiple: z.coerce.number().positive().optional(),
  preferredVendorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
})

export type PurchaseBillCreateInput = z.infer<typeof purchaseBillCreateSchema>
export type PurchaseBillLineInput = z.infer<typeof purchaseBillLineSchema>
export type ReorderingRuleCreateInput = z.infer<typeof reorderingRuleCreateSchema>
export type ReorderingRuleUpdateInput = z.infer<typeof reorderingRuleUpdateSchema>

// Vendors (Suppliers)
export const purchaseVendorCreateSchema = z.object({
  name: z.string().min(1, 'Vendor name is required').max(255),
  code: z.string().max(100).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  currencyCode: z.string().min(3).max(3).default('PLN'),
  paymentTerms: z.string().max(100).nullable().optional(),
  taxId: z.string().max(50).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
})

export const purchaseVendorUpdateSchema = z.object({
  name: z.string().min(1, 'Vendor name is required').max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  paymentTerms: z.string().max(100).nullable().optional(),
  taxId: z.string().max(50).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
})

export type PurchaseVendorCreateInput = z.infer<typeof purchaseVendorCreateSchema>
export type PurchaseVendorUpdateInput = z.infer<typeof purchaseVendorUpdateSchema>
