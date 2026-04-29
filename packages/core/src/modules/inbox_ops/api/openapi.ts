import { z } from 'zod'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'

const proposalStatusSchema = z.enum(['pending', 'partial', 'accepted', 'rejected'])
const proposalCategorySchema = z.enum([
  'rfq',
  'order',
  'order_update',
  'complaint',
  'shipping_update',
  'inquiry',
  'payment',
  'other',
])
const actionTypeSchema = z.enum([
  'create_order',
  'create_quote',
  'update_order',
  'update_shipment',
  'create_contact',
  'create_product',
  'link_contact',
  'log_activity',
  'draft_reply',
])
const actionStatusSchema = z.enum([
  'pending',
  'processing',
  'accepted',
  'rejected',
  'executed',
  'failed',
])
const discrepancyTypeSchema = z.enum([
  'price_mismatch',
  'quantity_mismatch',
  'unknown_contact',
  'currency_mismatch',
  'date_conflict',
  'product_not_found',
  'duplicate_order',
  'other',
])
const participantRoleSchema = z.enum([
  'buyer',
  'seller',
  'logistics',
  'finance',
  'other',
])

const isoDateSchema = z.union([z.string(), z.date()])

const extractedParticipantSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: participantRoleSchema,
  identifier: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  matchedContactId: z.string().uuid().nullable().optional(),
  matchedContactType: z.enum(['person', 'company']).nullable().optional(),
  matchConfidence: z.number().optional(),
})

export const extractResponseSchema = z.object({
  ok: z.boolean(),
  sourceSubmissionId: z.string().uuid(),
  emailId: z
    .string()
    .uuid()
    .describe('DEPRECATED: alias of sourceSubmissionId; removed in next minor version.'),
})

const proposalSourceBlockSchema = z.object({
  sourceSubmissionId: z.string().uuid().nullable(),
  sourceEntityType: z.string().nullable(),
  sourceEntityId: z.string().uuid().nullable(),
  sourceArtifactId: z.string().uuid().nullable(),
  sourceVersion: z.string().nullable(),
  sourceSnapshot: z.record(z.string(), z.unknown()).nullable(),
})

const proposalListItemSchema = z.object({
  id: z.string().uuid(),
  inboxEmailId: z.string().uuid().nullable(),
  sourceSubmissionId: z.string().uuid().nullable(),
  sourceEntityType: z.string().nullable(),
  sourceEntityId: z.string().uuid().nullable(),
  sourceArtifactId: z.string().uuid().nullable(),
  sourceVersion: z.string().nullable(),
  sourceSnapshot: z.record(z.string(), z.unknown()).nullable(),
  summary: z.string(),
  participants: z.array(extractedParticipantSchema),
  confidence: z.string(),
  detectedLanguage: z.string().nullable(),
  category: proposalCategorySchema.nullable(),
  status: proposalStatusSchema,
  possiblyIncomplete: z.boolean(),
  reviewedByUserId: z.string().uuid().nullable(),
  reviewedAt: isoDateSchema.nullable(),
  llmModel: z.string().nullable(),
  llmTokensUsed: z.number().nullable(),
  workingLanguage: z.string().nullable(),
  translations: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  deletedAt: isoDateSchema.nullable(),
  actionCount: z.number(),
  pendingActionCount: z.number(),
  discrepancyCount: z.number(),
  emailSubject: z.string().nullable(),
  emailFrom: z.string().nullable(),
  receivedAt: isoDateSchema.nullable(),
  legacyInboxEmailId: z.string().uuid().nullable(),
  sourceKind: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  sourceHint: z.string().nullable(),
  sourceIcon: z.string().nullable(),
})

export const proposalListResponseSchema = createPagedListResponseSchema(proposalListItemSchema)

const proposalActionSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  sortOrder: z.number(),
  actionType: actionTypeSchema,
  description: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: actionStatusSchema,
  confidence: z.string(),
  requiredFeature: z.string().nullable(),
  matchedEntityId: z.string().uuid().nullable(),
  matchedEntityType: z.string().nullable(),
  createdEntityId: z.string().uuid().nullable(),
  createdEntityType: z.string().nullable(),
  executionError: z.string().nullable(),
  executedAt: isoDateSchema.nullable(),
  executedByUserId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  deletedAt: isoDateSchema.nullable(),
})

const proposalDiscrepancySchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  actionId: z.string().uuid().nullable(),
  type: discrepancyTypeSchema,
  severity: z.enum(['warning', 'error']),
  description: z.string(),
  expectedValue: z.string().nullable(),
  foundValue: z.string().nullable(),
  resolved: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  deletedAt: isoDateSchema.nullable(),
})

const proposalEmailSchema = z.object({
  id: z.string().uuid(),
  forwardedByAddress: z.string(),
  forwardedByName: z.string().nullable(),
  toAddress: z.string(),
  subject: z.string(),
  receivedAt: isoDateSchema,
  status: z.enum(['received', 'processing', 'processed', 'needs_review', 'failed']),
  detectedLanguage: z.string().nullable(),
})

export const proposalDetailResponseSchema = z.object({
  proposal: proposalListItemSchema
    .omit({
      actionCount: true,
      pendingActionCount: true,
      discrepancyCount: true,
      emailSubject: true,
      emailFrom: true,
      receivedAt: true,
      sourceKind: true,
      sourceLabel: true,
      sourceHint: true,
      sourceIcon: true,
    })
    .extend({
      source: proposalSourceBlockSchema,
      legacyInboxEmailId: z.string().uuid().nullable(),
    }),
  actions: z.array(proposalActionSchema),
  discrepancies: z.array(proposalDiscrepancySchema),
  email: proposalEmailSchema.nullable(),
})
