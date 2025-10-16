import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const nextInteractionSchema = z
  .object({
    at: z.coerce.date(),
    name: z.string().min(1).max(200),
    refId: z.string().min(1).max(191).optional(),
  })
  .strict()

const baseEntitySchema = {
  displayName: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  ownerUserId: uuid().optional(),
  primaryEmail: z.string().email().max(320).optional(),
  primaryPhone: z.string().max(50).optional(),
  status: z.string().max(100).optional(),
  lifecycleStage: z.string().max(100).optional(),
  source: z.string().max(150).optional(),
  nextInteraction: nextInteractionSchema.optional(),
  tags: z.array(uuid()).optional(),
}

const personDetailsSchema = {
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  preferredName: z.string().max(120).optional(),
  jobTitle: z.string().max(150).optional(),
  department: z.string().max(150).optional(),
  seniority: z.string().max(100).optional(),
  timezone: z.string().max(120).optional(),
  linkedInUrl: z.string().url().max(300).optional(),
  twitterUrl: z.string().url().max(300).optional(),
  companyEntityId: uuid().optional(),
}

const companyDetailsSchema = {
  legalName: z.string().max(200).optional(),
  brandName: z.string().max(200).optional(),
  domain: z.string().max(200).optional(),
  websiteUrl: z.string().url().max(300).optional(),
  industry: z.string().max(150).optional(),
  sizeBucket: z.string().max(100).optional(),
  annualRevenue: z.coerce.number().min(0).optional(),
}

export const personCreateSchema = scopedSchema.extend({
  ...baseEntitySchema,
  ...personDetailsSchema,
})

export const personUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(personCreateSchema.partial())

export const companyCreateSchema = scopedSchema.extend({
  ...baseEntitySchema,
  ...companyDetailsSchema,
})

export const companyUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(companyCreateSchema.partial())

export const dealCreateSchema = scopedSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  status: z.string().max(50).optional(),
  pipelineStage: z.string().max(100).optional(),
  valueAmount: z.coerce.number().min(0).optional(),
  valueCurrency: z.string().min(3).max(3).optional(),
  probability: z.number().min(0).max(100).optional(),
  expectedCloseAt: z.coerce.date().optional(),
  ownerUserId: uuid().optional(),
  source: z.string().max(150).optional(),
  companyIds: z.array(uuid()).optional(),
  personIds: z.array(uuid()).optional(),
})

export const dealUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(dealCreateSchema.partial())

export const activityCreateSchema = scopedSchema.extend({
  entityId: uuid(),
  activityType: z.string().min(1).max(100),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  occurredAt: z.coerce.date().optional(),
  dealId: uuid().optional(),
  authorUserId: uuid().optional(),
})

export const activityUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(activityCreateSchema.partial())

export const commentCreateSchema = scopedSchema.extend({
  entityId: uuid(),
  dealId: uuid().optional(),
  body: z.string().min(1).max(8000),
  authorUserId: uuid().optional(),
})

export const commentUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(commentCreateSchema.partial())

export const addressCreateSchema = scopedSchema.extend({
  entityId: uuid(),
  name: z.string().max(150).optional(),
  purpose: z.string().max(150).optional(),
  addressLine1: z.string().min(1).max(300),
  addressLine2: z.string().max(300).optional(),
  city: z.string().max(150).optional(),
  region: z.string().max(150).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().max(150).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  isPrimary: z.boolean().optional(),
})

export const addressUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(addressCreateSchema.partial())

export const tagCreateSchema = scopedSchema.extend({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/, 'Slug must be lowercase and may contain dashes or underscores'),
  label: z.string().min(1).max(120),
  color: z.string().max(30).optional(),
  description: z.string().max(400).optional(),
})

export const tagUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(tagCreateSchema.partial())

export const tagAssignmentSchema = scopedSchema.extend({
  tagId: uuid(),
  entityId: uuid(),
})

export const todoLinkCreateSchema = scopedSchema.extend({
  entityId: uuid(),
  todoId: uuid(),
  todoSource: z.string().min(1).max(120).default('example:todo'),
  createdByUserId: uuid().optional(),
})

export const todoLinkWithTodoCreateSchema = scopedSchema.extend({
  entityId: uuid(),
  title: z.string().min(1).max(200),
  isDone: z.boolean().optional(),
  todoSource: z.string().min(1).max(120).default('example:todo'),
  createdByUserId: uuid().optional(),
  todoCustom: z.record(z.any()).optional(),
})

export type PersonCreateInput = z.infer<typeof personCreateSchema>
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>
export type DealCreateInput = z.infer<typeof dealCreateSchema>
export type DealUpdateInput = z.infer<typeof dealUpdateSchema>
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>
export type ActivityUpdateInput = z.infer<typeof activityUpdateSchema>
export type CommentCreateInput = z.infer<typeof commentCreateSchema>
export type CommentUpdateInput = z.infer<typeof commentUpdateSchema>
export type AddressCreateInput = z.infer<typeof addressCreateSchema>
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>
export type TagCreateInput = z.infer<typeof tagCreateSchema>
export type TagUpdateInput = z.infer<typeof tagUpdateSchema>
export type TagAssignmentInput = z.infer<typeof tagAssignmentSchema>
export type TodoLinkCreateInput = z.infer<typeof todoLinkCreateSchema>
export type TodoLinkWithTodoCreateInput = z.infer<typeof todoLinkWithTodoCreateSchema>
