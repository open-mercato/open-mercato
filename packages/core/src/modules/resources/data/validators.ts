import { z } from 'zod'

const scopedCreateFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
}

const scopedUpdateFields = {
  id: z.string().uuid(),
}

export const resourcesResourceTypeCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const resourcesResourceTypeUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const resourcesResourceCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  resourceTypeId: z.string().uuid().optional().nullable(),
  capacity: z.coerce.number().int().positive().optional().nullable(),
  capacityUnitValue: z.string().min(1).optional().nullable(),
  tags: z.array(z.string().uuid()).optional(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
  isActive: z.boolean().optional(),
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
})

export const resourcesResourceUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  resourceTypeId: z.string().uuid().optional().nullable(),
  capacity: z.coerce.number().int().positive().optional().nullable(),
  capacityUnitValue: z.string().min(1).optional().nullable(),
  tags: z.array(z.string().uuid()).optional(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
  isActive: z.boolean().optional(),
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
})

export const resourcesResourceTagCreateSchema = z.object({
  ...scopedCreateFields,
  slug: z.string().min(1).optional(),
  label: z.string().min(1),
  color: z.string().trim().max(50).optional().nullable(),
  description: z.string().optional().nullable(),
})

export const resourcesResourceTagUpdateSchema = z.object({
  ...scopedUpdateFields,
  slug: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  color: z.string().trim().max(50).optional().nullable(),
  description: z.string().optional().nullable(),
})

export const resourcesResourceTagAssignmentSchema = z.object({
  ...scopedCreateFields,
  tagId: z.string().uuid(),
  resourceId: z.string().uuid(),
})

export const resourcesResourceCommentCreateSchema = z.object({
  ...scopedCreateFields,
  entityId: z.string().uuid(),
  body: z.string().min(1).max(8000),
  authorUserId: z.string().uuid().optional(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const resourcesResourceCommentUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(resourcesResourceCommentCreateSchema.partial())

export const resourcesResourceActivityCreateSchema = z.object({
  ...scopedCreateFields,
  entityId: z.string().uuid(),
  activityType: z.string().min(1).max(100),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  occurredAt: z.coerce.date().optional(),
  authorUserId: z.string().uuid().optional(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const resourcesResourceActivityUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(resourcesResourceActivityCreateSchema.partial())

export type ResourcesResourceTypeCreateInput = z.infer<typeof resourcesResourceTypeCreateSchema>
export type ResourcesResourceTypeUpdateInput = z.infer<typeof resourcesResourceTypeUpdateSchema>
export type ResourcesResourceCreateInput = z.infer<typeof resourcesResourceCreateSchema>
export type ResourcesResourceUpdateInput = z.infer<typeof resourcesResourceUpdateSchema>
export type ResourcesResourceTagCreateInput = z.infer<typeof resourcesResourceTagCreateSchema>
export type ResourcesResourceTagUpdateInput = z.infer<typeof resourcesResourceTagUpdateSchema>
export type ResourcesResourceTagAssignmentInput = z.infer<typeof resourcesResourceTagAssignmentSchema>
export type ResourcesResourceCommentCreateInput = z.infer<typeof resourcesResourceCommentCreateSchema>
export type ResourcesResourceCommentUpdateInput = z.infer<typeof resourcesResourceCommentUpdateSchema>
export type ResourcesResourceActivityCreateInput = z.infer<typeof resourcesResourceActivityCreateSchema>
export type ResourcesResourceActivityUpdateInput = z.infer<typeof resourcesResourceActivityUpdateSchema>
