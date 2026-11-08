import { z } from 'zod'
import type { AttachmentAccessResolver } from '../lib/access-types'

export const attachmentStorageConfigurationSchema = z.custom<Record<string, unknown>>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
})

export const attachmentStorageScopeSchema = z.object({
  tenantId: z.string(),
  organizationId: z.string(),
}).refine((scope) => Boolean(scope.tenantId.trim()) === Boolean(scope.organizationId.trim()))

export const attachmentAccessActionSchema = z.enum(['read', 'render', 'metadata', 'reassign', 'delete', 'export'])
export const attachmentAccessSubjectFeaturesSchema = z.array(z.string())
export const attachmentAccessSelectorSchema = z.string().min(1).max(200).regex(/^(?:\*|[^*\s]+(?:\.\*)?)$/)
const resolverIdSchema = z.string().min(3).max(200).regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/)

export const attachmentAccessRequirementSchema = z.object({
  resolverId: resolverIdSchema,
  targetEntity: attachmentAccessSelectorSchema,
}).strict()

/** An exact owner entity id: the library exclusion matches `entity_id` by equality, never by pattern. */
export const attachmentLibraryExcludedEntitySchema = z.string().min(1).max(200).regex(/^[^*\s]+$/)
export const attachmentLibraryExcludedEntitiesSchema = z.array(attachmentLibraryExcludedEntitySchema)

export const protectedAttachmentTargetSchema = attachmentAccessRequirementSchema.extend({
  targetPartition: attachmentAccessSelectorSchema,
  listInLibrary: z.boolean().optional(),
}).superRefine((target, ctx) => {
  if (target.listInLibrary === false && !attachmentLibraryExcludedEntitySchema.safeParse(target.targetEntity).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['listInLibrary'],
      message: 'listInLibrary: false requires an exact targetEntity, not a wildcard',
    })
  }
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
