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
  toName: z.string().trim().max(300).optional().nullable(),
  replyTo: z.string().trim().email().max(320).optional().nullable(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(10000),
  inReplyToMessageId: z.string().trim().max(500).optional().nullable(),
  references: z.array(z.string().trim().max(500)).optional().nullable(),
  context: z.string().trim().max(4000).optional().nullable(),
})

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const inboxProposalCategoryEnum = z.enum([
  'rfq',
  'order',
  'order_update',
  'complaint',
  'shipping_update',
  'inquiry',
  'payment',
  'other',
])

export const ALL_CATEGORIES = inboxProposalCategoryEnum.options

const proposalCategoryFilterSchema = z.string()
  .trim()
  .max(200)
  .refine((value) => {
    const categories = value.split(',').map((category) => category.trim()).filter(Boolean)
    return (
      categories.length > 0 &&
      categories.every((category) => inboxProposalCategoryEnum.safeParse(category).success)
    )
  }, {
    message: `Category filter must contain only: ${ALL_CATEGORIES.join(', ')}`,
  })

export const categorizeProposalSchema = z.object({
  category: inboxProposalCategoryEnum,
})

// ---------------------------------------------------------------------------
// LLM Extraction Output Schema
// ---------------------------------------------------------------------------

export const extractedParticipantSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.enum(['buyer', 'seller', 'logistics', 'finance', 'other']),
})

/**
 * Field provenance as the LLM returns it. Deliberately lenient: a model that overshoots a bound or
 * returns a malformed ref must not fail the whole `generateObject` extraction. A bad optional field
 * is dropped (`.catch(undefined)`); a ref whose `kind`/`snippet` is unusable, or that is not an object,
 * parses to `undefined` and is dropped by the worker's normalizer (`lib/sourceRefs.ts`), which turns
 * the survivors into {@link inboxProposalActionSourceRefSchema} before persisting. `.catch` is
 * transparent to the JSON-schema conversion, so the model still sees the full ref shape.
 */
export const extractedSourceRefSchema = z
  .object({
    kind: z.enum(['email_body', 'attachment']),
    attachmentId: z.string().optional().catch(undefined).describe('attachmentId attribute of the cited <attachment> block'),
    fileName: z.string().optional().catch(undefined),
    page: z.number().optional().catch(undefined),
    sheet: z.string().optional().catch(undefined),
    row: z.number().optional().catch(undefined),
    snippet: z.string().describe('Short verbatim quote of the source text'),
  })
  .optional()
  .catch(undefined)

export const INBOX_SOURCE_REFS_MAX_PER_ACTION = 10
export const INBOX_SOURCE_REF_SNIPPET_MAX_CHARS = 500
export const INBOX_SOURCE_REF_FILE_NAME_MAX_CHARS = 255
export const INBOX_SOURCE_REF_SHEET_MAX_CHARS = 100

/** Stored shape of `inbox_proposal_actions.source_refs` entries (bounded). */
export const inboxProposalActionSourceRefSchema = z.object({
  kind: z.enum(['email_body', 'attachment']),
  attachmentId: z.guid().optional(),
  fileName: z.string().min(1).max(INBOX_SOURCE_REF_FILE_NAME_MAX_CHARS).optional(),
  page: z.number().int().positive().optional(),
  sheet: z.string().min(1).max(INBOX_SOURCE_REF_SHEET_MAX_CHARS).optional(),
  row: z.number().int().positive().optional(),
  snippet: z.string().min(1).max(INBOX_SOURCE_REF_SNIPPET_MAX_CHARS),
})

export const inboxProposalActionSourceRefsSchema = z
  .array(inboxProposalActionSourceRefSchema)
  .max(INBOX_SOURCE_REFS_MAX_PER_ACTION)

export type InboxProposalActionSourceRefInput = z.infer<typeof inboxProposalActionSourceRefSchema>

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
  sourceRefs: z
    .array(extractedSourceRefSchema)
    .optional()
    .catch(undefined)
    .describe('Where the proposed values were found: the email body or an attachment'),
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
  category: inboxProposalCategoryEnum.optional(),
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
  // Per-tenant inbound-webhook secret. Write-only: it is never returned by the
  // settings GET. A non-empty value binds custom-provider webhook signatures for
  // this inbox to this secret; null/empty clears it and reverts to the global key.
  webhookSecret: z.string().trim().min(16).max(256).nullable().optional(),
})

// ---------------------------------------------------------------------------
// Inbound attachment metadata (Resend `receiving.get()` → `attachments[]`)
// ---------------------------------------------------------------------------

/** A well-formed metadata entry. */
export const resendInboundAttachmentStrictSchema = z.object({
  id: z.string().trim().min(1),
  filename: z.string().nullish(),
  size: z.number().int().nonnegative(),
  content_type: z.string().nullish(),
  content_id: z.string().nullish(),
  content_disposition: z.string().nullish(),
})

/**
 * A metadata entry as the webhook reads it: only the provider `id` is required, because it names
 * the part to fetch and enters the content hash (D13). Any other malformed field degrades to
 * `null` (an unknown `size` is reserved at the per-file maximum against the total limit).
 */
export const resendInboundAttachmentSchema = z.object({
  id: z.string().trim().min(1),
  filename: z.string().nullish().catch(null),
  size: z.number().int().nonnegative().nullable().catch(null),
  content_type: z.string().nullish().catch(null),
  content_id: z.string().nullish().catch(null),
  content_disposition: z.string().nullish().catch(null),
})

export type ResendInboundAttachment = z.infer<typeof resendInboundAttachmentSchema>

/** `inbox_emails.metadata.attachmentIngest`: where the ingest worker fetches the parts from. */
export const inboxEmailAttachmentIngestMetadataSchema = z.object({
  provider: z.literal('resend'),
  providerEmailId: z.string().trim().min(1),
  /** Metadata entries past the per-email ledger cap, not recorded as ledger rows. */
  omittedParts: z.number().int().positive().optional(),
})

export type InboxEmailAttachmentIngestMetadata = z.infer<typeof inboxEmailAttachmentIngestMetadataSchema>

/** Payload of an `inbox-ops-attachment-ingest` job: ids and the ingest generation, nothing else. */
export const inboundAttachmentIngestJobSchema = z.object({
  emailId: z.guid(),
  tenantId: z.guid(),
  organizationId: z.guid(),
  generation: z.number().int().positive(),
})

export type InboundAttachmentIngestJob = z.infer<typeof inboundAttachmentIngestJobSchema>

// ---------------------------------------------------------------------------
// Attachment list API (`GET /api/inbox_ops/emails/[id]/attachments`)
// ---------------------------------------------------------------------------

export const inboxEmailIdParamsSchema = z.object({
  id: z.guid(),
})

export const inboxEmailAttachmentDispositionSchema = z.enum(['attachment', 'inline'])

export const inboxEmailAttachmentStatusSchema = z.enum(['pending', 'stored', 'skipped', 'failed', 'released'])

export const inboxEmailAttachmentReasonSchema = z.enum([
  'inline_decoration',
  'too_many',
  'too_large',
  'total_too_large',
  'dangerous_executable',
  'active_content',
  'unguarded_reader',
  'quota_exceeded',
  'partition_unavailable',
  'fetch_failed',
  'store_failed',
  'processing_failed',
  'ingest_timeout',
])

export const inboxEmailAttachmentListItemSchema = z.object({
  id: z.guid(),
  partKey: z.string(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  disposition: inboxEmailAttachmentDispositionSchema,
  status: inboxEmailAttachmentStatusSchema,
  reason: inboxEmailAttachmentReasonSchema.nullable(),
  attachmentId: z.guid().nullable(),
  url: z.string().nullable(),
})

export type InboxEmailAttachmentListItem = z.infer<typeof inboxEmailAttachmentListItemSchema>

export const inboxEmailAttachmentListResponseSchema = z.object({
  items: z.array(inboxEmailAttachmentListItemSchema),
})

export type InboxEmailAttachmentListResponse = z.infer<typeof inboxEmailAttachmentListResponseSchema>

// ---------------------------------------------------------------------------
// API Query Schemas
// ---------------------------------------------------------------------------

export const proposalListQuerySchema = z.object({
  status: z.enum(['pending', 'partial', 'accepted', 'rejected']).optional(),
  category: proposalCategoryFilterSchema.optional(),
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
  registeredSchema?: z.ZodType,
): { success: true } | { success: false; error: string } {
  const schema = registeredSchema ?? ACTION_PAYLOAD_SCHEMAS[actionType]
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
