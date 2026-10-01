import { z } from 'zod'
import type { AttachmentAccessResolver } from '../lib/access-types'

export const attachmentAccessActionSchema = z.enum(['read', 'render', 'metadata', 'reassign', 'delete', 'export'])
export const attachmentAccessSelectorSchema = z.string().min(1).max(200).regex(/^(?:\*|[^*\s]+(?:\.\*)?)$/)
const resolverIdSchema = z.string().min(3).max(200).regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/)

export const attachmentAccessRequirementSchema = z.object({
  resolverId: resolverIdSchema,
  targetEntity: attachmentAccessSelectorSchema,
}).strict()

export const protectedAttachmentTargetSchema = attachmentAccessRequirementSchema.extend({
  targetPartition: attachmentAccessSelectorSchema,
})

export const attachmentAccessResolverSchema = z.object({
  id: resolverIdSchema,
  targetPartition: attachmentAccessSelectorSchema,
  targetEntity: attachmentAccessSelectorSchema.optional(),
  actions: z.array(attachmentAccessActionSchema).min(1).optional(),
  priority: z.number().finite().optional(),
  timeoutMs: z.number().int().min(1).max(15_000).optional(),
  resolve: z.custom<AttachmentAccessResolver['resolve']>((value) => typeof value === 'function'),
}).strict()

export const attachmentAccessRequirementsSchema = z.array(attachmentAccessRequirementSchema)
export const attachmentAccessDecisionSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.union([z.literal(401), z.literal(403), z.literal(404), z.literal(504)]),
    reason: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/),
  }).strict(),
])
