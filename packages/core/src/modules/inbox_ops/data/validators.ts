import { z } from 'zod'

const uuid = () => z.string().uuid()
const coerceNumericString = z.preprocess(
  (val) => (typeof val === 'number' ? String(val) : val),
  z.string().regex(/^\d+(\.\d+)?$/),
)

// ---------------------------------------------------------------------------
// Action Payload Schemas
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  line1: z.string().trim().max(500).optional(),
  line2: z.string().trim().max(500).optional(),
  city: z.string().trim().max(200).optional(),
  state: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(50).optional(),
  country: z.string().trim().max(200).optional(),
  company: z.string().trim().max(300).optional(),
  contactName: z.string().trim().max(300).optional(),
}).optional()

export const orderPayloadSchema = z.object({
  customerEntityId: uuid().optional(),
  customerName: z.string().trim().min(1).max(300),
  customerEmail: z.string().trim().email().max(320).optional(),
  channelId: uuid().optional(),
  currencyCode: z.string().trim().length(3),
  taxRateId: uuid().optional(),
  lineItems: z.array(z.object({
    productName: z.string().trim().min(1).max(300),
    productId: uuid().optional(),
    variantId: uuid().optional(),
    sku: z.string().trim().max(100).optional(),
    quantity: coerceNumericString,
    unitPrice: coerceNumericString.optional(),
    catalogPrice: z.string().optional(),
    kind: z.enum(['product', 'service']).default('product'),
    description: z.string().trim().max(2000).optional(),
  })).min(1).max(100),
  requestedDeliveryDate: z.string().optional(),
  notes: z.string().trim().max(4000).optional(),
  customerReference: z.string().trim().max(200).optional(),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  shippingAddressId: uuid().optional(),
  billingAddressId: uuid().optional(),
})

export const updateOrderPayloadSchema = z
  .object({
    orderId: uuid().optional(),
    orderNumber: z.string().trim().max(100).optional(),
    quantityChanges: z.array(z.object({
      lineItemName: z.string().trim().min(1).max(300),
      lineItemId: uuid().optional(),
      oldQuantity: z.string().optional(),
      newQuantity: z.string().regex(/^\d+(\.\d+)?$/),
    })).optional(),
    deliveryDateChange: z.object({
      oldDate: z.string().optional(),
      newDate: z.string(),
    }).optional(),
    noteAdditions: z.array(z.string().trim().max(4000)).optional(),
  })
  .refine((value) => Boolean(value.orderId || value.orderNumber), {
    message: 'order_reference_required',
  })

export const updateShipmentPayloadSchema = z
  .object({
    orderId: uuid().optional(),
    orderNumber: z.string().trim().max(100).optional(),
    trackingNumbers: z.array(z.string().trim().max(200)).optional(),
    carrierName: z.string().trim().max(200).optional(),
    statusLabel: z.string().trim().min(1).max(200),
    shippedAt: z.string().optional(),
    deliveredAt: z.string().optional(),
    estimatedDelivery: z.string().optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((value) => Boolean(value.orderId || value.orderNumber), {
    message: 'order_reference_required',
  })

const lowercaseContactType = z.preprocess(
  (val) => (typeof val === 'string' ? val.toLowerCase() : val),
  z.enum(['person', 'company']),
)

export const createContactPayloadSchema = z.object({
  type: lowercaseContactType,
  name: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  companyName: z.string().trim().max(300).optional(),
  role: z.string().trim().max(150).optional(),
  source: z.literal('inbox_ops').default('inbox_ops'),
})

export const linkContactPayloadSchema = z.object({
  emailAddress: z.string().trim().email().max(320),
  contactId: uuid(),
  contactType: lowercaseContactType,
  contactName: z.string().trim().min(1).max(300),
})

export const createProductPayloadSchema = z.object({
  title: z.string().trim().min(1).max(255),
  sku: z.string().trim().max(100).optional(),
  unitPrice: coerceNumericString.optional(),
  currencyCode: z.string().trim().length(3).optional(),
  kind: z.enum(['product', 'service']).default('product'),
  description: z.string().trim().max(4000).optional(),
})

export const logActivityPayloadSchema = z.object({
  contactId: uuid().optional(),
  contactType: lowercaseContactType,
  contactName: z.string().trim().min(1).max(300),
  activityType: z.enum(['email', 'call', 'meeting', 'note']),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().max(8000),
})

export const draftReplyPayloadSchema = z.object({
  to: z.string().trim().email().max(320),
  toName: z.string().trim().max(300).optional(),
  replyTo: z.string().trim().email().max(320).optional(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(10000),
  inReplyToMessageId: z.string().trim().max(500).optional(),
  references: z.array(z.string().trim().max(500)).optional(),
  context: z.string().trim().max(4000).optional(),
})

// ---------------------------------------------------------------------------
// LLM Extraction Output Schema
// ---------------------------------------------------------------------------

export const extractedParticipantSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.enum(['buyer', 'seller', 'logistics', 'finance', 'other']),
})

export const extractedActionSchema = z.object({
  actionType: z.enum([
    'create_order',
    'create_quote',
    'update_order',
    'update_shipment',
    'create_contact',
    'create_product',
    'link_contact',
    'log_activity',
    'draft_reply',
  ]),
  description: z.string(),
  confidence: z.number(),
  requiredFeature: z.string().optional(),
  payloadJson: z.string().describe('JSON-encoded payload object for this action'),
})

export const extractedDiscrepancySchema = z.object({
  type: z.enum([
    'price_mismatch',
    'quantity_mismatch',
    'unknown_contact',
    'currency_mismatch',
    'date_conflict',
    'product_not_found',
    'duplicate_order',
    'other',
  ]),
  severity: z.enum(['warning', 'error']),
  description: z.string(),
  expectedValue: z.string().optional(),
  foundValue: z.string().optional(),
  actionIndex: z.number().optional(),
})

export const extractionOutputSchema = z.object({
  summary: z.string(),
  participants: z.array(extractedParticipantSchema),
  proposedActions: z.array(extractedActionSchema),
  discrepancies: z.array(extractedDiscrepancySchema),
  draftReplies: z.array(z.object({
    to: z.string(),
    toName: z.string().optional(),
    subject: z.string(),
    body: z.string(),
    context: z.string().optional(),
  })),
  confidence: z.number(),
  detectedLanguage: z.string().optional(),
  possiblyIncomplete: z.boolean().optional(),
})

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>
export type OrderPayload = z.infer<typeof orderPayloadSchema>
export type UpdateOrderPayload = z.infer<typeof updateOrderPayloadSchema>
export type UpdateShipmentPayload = z.infer<typeof updateShipmentPayloadSchema>
export type CreateContactPayload = z.infer<typeof createContactPayloadSchema>
export type CreateProductPayload = z.infer<typeof createProductPayloadSchema>
export type LinkContactPayload = z.infer<typeof linkContactPayloadSchema>
export type LogActivityPayload = z.infer<typeof logActivityPayloadSchema>
export type DraftReplyPayload = z.infer<typeof draftReplyPayloadSchema>

// ---------------------------------------------------------------------------
// Translation / Settings Schemas
// ---------------------------------------------------------------------------

export const translateProposalSchema = z.object({
  targetLocale: z.enum(['en', 'de', 'es', 'pl']),
})

export const updateSettingsSchema = z.object({
  workingLanguage: z.enum(['en', 'de', 'es', 'pl']).optional(),
  isActive: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// API Query Schemas
// ---------------------------------------------------------------------------

export const proposalListQuerySchema = z.object({
  status: z.enum(['pending', 'partial', 'accepted', 'rejected']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const emailListQuerySchema = z.object({
  status: z.enum(['received', 'processing', 'processed', 'needs_review', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const actionEditSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
})

const ACTION_PAYLOAD_SCHEMAS: Record<string, z.ZodType> = {
  create_order: orderPayloadSchema,
  create_quote: orderPayloadSchema,
  update_order: updateOrderPayloadSchema,
  update_shipment: updateShipmentPayloadSchema,
  create_contact: createContactPayloadSchema,
  create_product: createProductPayloadSchema,
  link_contact: linkContactPayloadSchema,
  log_activity: logActivityPayloadSchema,
  draft_reply: draftReplyPayloadSchema,
}

export function validateActionPayloadForType(
  actionType: string,
  payload: Record<string, unknown>,
): { success: true } | { success: false; error: string } {
  const schema = ACTION_PAYLOAD_SCHEMAS[actionType]
  if (!schema) {
    return { success: true }
  }

  const result = schema.safeParse(payload)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { success: false, error: `Invalid payload for ${actionType}: ${issues}` }
  }
  return { success: true }
}
