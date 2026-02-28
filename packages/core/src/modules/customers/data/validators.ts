import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const nextInteractionSchema = z
  .object({
    at: z.coerce.date(),
    name: z.string().trim().min(1).max(200),
    refId: z.string().trim().max(191).optional().nullable(),
    icon: z.string().trim().max(100).optional().nullable(),
    color: z
      .string()
      .trim()
      .regex(/^#([0-9a-fA-F]{6})$/)
      .optional()
      .nullable(),
  })
  .strict()

const displayNameSchema = z.string().trim().min(1).max(200)

const baseEntitySchema = {
  displayName: displayNameSchema,
  description: z.string().trim().max(4000).optional(),
  ownerUserId: uuid().optional(),
  primaryEmail: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional(),
  primaryPhone: z.string().trim().max(50).optional(),
  status: z.string().trim().max(100).optional(),
  lifecycleStage: z.string().trim().max(100).optional(),
  source: z.string().trim().max(150).optional(),
  isActive: z.boolean().optional(),
  nextInteraction: nextInteractionSchema.nullable().optional(),
  tags: z.array(uuid()).optional(),
}

const personDetailsSchema = {
  preferredName: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(150).optional(),
  department: z.string().trim().max(150).optional(),
  seniority: z.string().trim().max(100).optional(),
  timezone: z.string().trim().max(120).optional(),
  linkedInUrl: z.string().trim().url().max(300).optional(),
  twitterUrl: z.string().trim().url().max(300).optional(),
  companyEntityId: uuid().nullable().optional(),
}

const personFirstNameSchema = z.string().trim().min(1).max(120)
const personLastNameSchema = z.string().trim().min(1).max(120)

const companyDetailsSchema = {
  legalName: z.string().trim().max(200).optional(),
  brandName: z.string().trim().max(200).optional(),
  domain: z.string().trim().max(200).optional(),
  websiteUrl: z.string().trim().url().max(300).optional(),
  industry: z.string().trim().max(150).optional(),
  sizeBucket: z.string().trim().max(100).optional(),
  annualRevenue: z.coerce.number().min(0).optional(),
}

export const personCreateSchema = scopedSchema.extend({
  ...baseEntitySchema,
  displayName: displayNameSchema.optional(),
  firstName: personFirstNameSchema,
  lastName: personLastNameSchema,
  ...personDetailsSchema,
})

export const personUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(
    scopedSchema.extend({
      ...baseEntitySchema,
      ...personDetailsSchema,
      firstName: personFirstNameSchema.optional(),
      lastName: personLastNameSchema.optional(),
    }).partial()
  )

export const companyCreateSchema = scopedSchema.extend({
  ...baseEntitySchema,
  displayName: displayNameSchema,
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
  pipelineId: uuid().optional(),
  pipelineStageId: uuid().optional(),
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
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
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
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
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
  companyName: z.string().max(200).optional(),
  addressLine1: z.string().min(1).max(300),
  addressLine2: z.string().max(300).optional(),
  buildingNumber: z.string().max(50).optional(),
  flatNumber: z.string().max(50).optional(),
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

const dictionaryKindEnum = z.enum([
  'status',
  'source',
  'lifecycle_stage',
  'address_type',
  'activity_type',
  'deal_status',
  'pipeline_stage',
  'job_title',
  'industry',
])

const dictionaryValueSchema = z.string().trim().min(1).max(150)
const dictionaryLabelSchema = z.string().trim().max(150)
const dictionaryColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{6})$/, 'Color must be a valid six-digit hex code like #3366ff')
const dictionaryIconSchema = z.string().trim().max(48)

export const customerDictionaryEntryCreateSchema = scopedSchema.extend({
  kind: dictionaryKindEnum,
  value: dictionaryValueSchema,
  label: dictionaryLabelSchema.optional(),
  color: dictionaryColorSchema.nullable().optional(),
  icon: dictionaryIconSchema.nullable().optional(),
})

export type CustomerDictionaryEntryCreateInput = z.infer<typeof customerDictionaryEntryCreateSchema>

export const customerDictionaryEntryUpdateSchema = scopedSchema
  .extend({
    id: uuid(),
    kind: dictionaryKindEnum,
    value: dictionaryValueSchema.optional(),
    label: dictionaryLabelSchema.optional(),
    color: dictionaryColorSchema.nullable().optional(),
    icon: dictionaryIconSchema.nullable().optional(),
  })
  .refine(
    (payload) =>
      payload.value !== undefined ||
      payload.label !== undefined ||
      payload.color !== undefined ||
      payload.icon !== undefined,
    {
      message: 'Provide at least one field to update.',
      path: ['value'],
    }
  )

export type CustomerDictionaryEntryUpdateInput = z.infer<typeof customerDictionaryEntryUpdateSchema>

export const customerDictionaryEntryDeleteSchema = scopedSchema.extend({
  id: uuid(),
  kind: dictionaryKindEnum,
})

export type CustomerDictionaryEntryDeleteInput = z.infer<typeof customerDictionaryEntryDeleteSchema>

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
  is_done: z.boolean().optional(),
  todoSource: z.string().min(1).max(120).default('example:todo'),
  createdByUserId: uuid().optional(),
  todoCustom: z.record(z.string(), z.any()).optional(),
  custom: z.record(z.string(), z.any()).optional(),
})

export const customerAddressFormatSchema = z.enum(['line_first', 'street_first'])

export const customerSettingsUpsertSchema = scopedSchema.extend({
  addressFormat: customerAddressFormatSchema,
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
export type CustomerSettingsUpsertInput = z.infer<typeof customerSettingsUpsertSchema>
export type CustomerAddressFormatInput = z.infer<typeof customerAddressFormatSchema>

// --- Pipeline schemas ---

export const pipelineCreateSchema = scopedSchema.extend({
  name: z.string().trim().min(1).max(200),
  isDefault: z.boolean().optional(),
})

export const pipelineUpdateSchema = z.object({
  id: uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  isDefault: z.boolean().optional(),
})

export const pipelineDeleteSchema = z.object({
  id: uuid(),
})

export type PipelineCreateInput = z.infer<typeof pipelineCreateSchema>
export type PipelineUpdateInput = z.infer<typeof pipelineUpdateSchema>
export type PipelineDeleteInput = z.infer<typeof pipelineDeleteSchema>

// --- Pipeline Stage schemas ---

export const pipelineStageCreateSchema = scopedSchema.extend({
  pipelineId: uuid(),
  label: z.string().trim().min(1).max(200),
  order: z.number().int().min(0).optional(),
  color: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(100).optional(),
})

export const pipelineStageUpdateSchema = z.object({
  id: uuid(),
  label: z.string().trim().min(1).max(200).optional(),
  order: z.number().int().min(0).optional(),
  color: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(100).optional(),
})

export const pipelineStageDeleteSchema = z.object({
  id: uuid(),
})

export const pipelineStageReorderSchema = scopedSchema.extend({
  stages: z.array(z.object({
    id: uuid(),
    order: z.number().int().min(0),
  })).min(1),
})

export type PipelineStageCreateInput = z.infer<typeof pipelineStageCreateSchema>
export type PipelineStageUpdateInput = z.infer<typeof pipelineStageUpdateSchema>
export type PipelineStageDeleteInput = z.infer<typeof pipelineStageDeleteSchema>
export type PipelineStageReorderInput = z.infer<typeof pipelineStageReorderSchema>
