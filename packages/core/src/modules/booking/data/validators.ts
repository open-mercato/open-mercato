import { z } from 'zod'

const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid ISO date string',
})

const tagsSchema = z.array(z.string().min(1)).optional().default([])

const roleRequirementSchema = z.object({
  roleId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
})

const memberRequirementSchema = z.object({
  memberId: z.string().uuid(),
  qty: z.coerce.number().int().positive().optional(),
})

const resourceRequirementSchema = z.object({
  resourceId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
})

const resourceTypeRequirementSchema = z.object({
  resourceTypeId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
})

const capacityModelSchema = z.enum(['one_to_one', 'one_to_many', 'many_to_many'])
const eventStatusSchema = z.enum(['draft', 'negotiation', 'confirmed', 'cancelled'])
const confirmationModeSchema = z.enum(['all_members', 'any_member', 'by_role'])
const confirmationStatusSchema = z.enum(['pending', 'accepted', 'declined'])
const availabilitySubjectSchema = z.enum(['member', 'resource', 'ruleset'])
const availabilityKindSchema = z.enum(['availability', 'unavailability'])

const scopedCreateFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
}

const scopedUpdateFields = {
  id: z.string().uuid(),
}

export const bookingServiceCreateSchema = z
  .object({
    ...scopedCreateFields,
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    durationMinutes: z.coerce.number().int().positive(),
    capacityModel: capacityModelSchema,
    maxAttendees: z.coerce.number().int().positive().optional().nullable(),
    requiredRoles: z.array(roleRequirementSchema).optional().default([]),
    requiredMembers: z.array(memberRequirementSchema).optional().default([]),
    requiredResources: z.array(resourceRequirementSchema).optional().default([]),
    requiredResourceTypes: z.array(resourceTypeRequirementSchema).optional().default([]),
    tags: tagsSchema,
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.capacityModel !== 'one_to_one' && !value.maxAttendees) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'maxAttendees is required for capacity models with multiple attendees.' })
    }
  })

export const bookingServiceUpdateSchema = z
  .object({
    ...scopedUpdateFields,
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    capacityModel: capacityModelSchema.optional(),
    maxAttendees: z.coerce.number().int().positive().optional().nullable(),
    requiredRoles: z.array(roleRequirementSchema).optional(),
    requiredMembers: z.array(memberRequirementSchema).optional(),
    requiredResources: z.array(resourceRequirementSchema).optional(),
    requiredResourceTypes: z.array(resourceTypeRequirementSchema).optional(),
    tags: z.array(z.string().min(1)).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.capacityModel && value.capacityModel !== 'one_to_one' && value.maxAttendees === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'maxAttendees is required when changing capacity model.' })
    }
  })

export const bookingTeamRoleCreateSchema = z.object({
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

export const bookingTeamRoleUpdateSchema = z.object({
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

export const bookingTeamMemberCreateSchema = z.object({
  ...scopedCreateFields,
  displayName: z.string().min(1),
  description: z.string().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  roleIds: z.array(z.string().uuid()).optional().default([]),
  tags: tagsSchema,
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const bookingTeamMemberUpdateSchema = z.object({
  ...scopedUpdateFields,
  displayName: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  roleIds: z.array(z.string().uuid()).optional(),
  tags: z.array(z.string().min(1)).optional(),
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const bookingResourceTypeCreateSchema = z.object({
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

export const bookingResourceTypeUpdateSchema = z.object({
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

export const bookingResourceCreateSchema = z.object({
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

export const bookingResourceUpdateSchema = z.object({
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

export const bookingAvailabilityRuleCreateSchema = z.object({
  ...scopedCreateFields,
  subjectType: availabilitySubjectSchema,
  subjectId: z.string().uuid(),
  timezone: z.string().min(1),
  rrule: z.string().min(1),
  exdates: z.array(isoDateString).optional().default([]),
  kind: availabilityKindSchema.optional().default('availability'),
  note: z.string().trim().max(200).optional().nullable(),
})

export const bookingAvailabilityRuleUpdateSchema = z.object({
  ...scopedUpdateFields,
  subjectType: availabilitySubjectSchema.optional(),
  subjectId: z.string().uuid().optional(),
  timezone: z.string().min(1).optional(),
  rrule: z.string().min(1).optional(),
  exdates: z.array(isoDateString).optional(),
  kind: availabilityKindSchema.optional(),
  note: z.string().trim().max(200).optional().nullable(),
})

export const bookingAvailabilityRuleSetCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  timezone: z.string().min(1),
})

export const bookingAvailabilityRuleSetUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  timezone: z.string().min(1).optional(),
})

export const bookingEventCreateSchema = z
  .object({
    ...scopedCreateFields,
    serviceId: z.string().uuid(),
    title: z.string().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().optional().nullable(),
    rrule: z.string().optional().nullable(),
    exdates: z.array(isoDateString).optional().default([]),
    status: eventStatusSchema.optional().default('draft'),
    requiresConfirmations: z.boolean().optional().default(false),
    confirmationMode: confirmationModeSchema.optional().default('all_members'),
    confirmationDeadlineAt: z.coerce.date().optional().nullable(),
    confirmedAt: z.coerce.date().optional().nullable(),
    tags: tagsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startsAt must be before endsAt.' })
    }
    if (value.confirmationDeadlineAt && value.startsAt && value.confirmationDeadlineAt <= value.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'confirmationDeadlineAt must be after startsAt.' })
    }
  })

export const bookingEventUpdateSchema = z
  .object({
    ...scopedUpdateFields,
    serviceId: z.string().uuid().optional(),
    title: z.string().min(1).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    timezone: z.string().optional().nullable(),
    rrule: z.string().optional().nullable(),
    exdates: z.array(isoDateString).optional(),
    status: eventStatusSchema.optional(),
    requiresConfirmations: z.boolean().optional(),
    confirmationMode: confirmationModeSchema.optional(),
    confirmationDeadlineAt: z.coerce.date().optional().nullable(),
    confirmedAt: z.coerce.date().optional().nullable(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startsAt must be before endsAt.' })
    }
    if (value.confirmationDeadlineAt && value.startsAt && value.confirmationDeadlineAt <= value.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'confirmationDeadlineAt must be after startsAt.' })
    }
  })

export const bookingEventAttendeeCreateSchema = z.object({
  ...scopedCreateFields,
  eventId: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  attendeeType: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
  tags: tagsSchema,
  notes: z.string().optional().nullable(),
})

export const bookingEventAttendeeUpdateSchema = z.object({
  ...scopedUpdateFields,
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  attendeeType: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
  tags: z.array(z.string().min(1)).optional(),
  notes: z.string().optional().nullable(),
})

export const bookingEventMemberCreateSchema = z.object({
  ...scopedCreateFields,
  eventId: z.string().uuid(),
  memberId: z.string().uuid(),
  roleId: z.string().uuid().optional().nullable(),
})

export const bookingEventMemberUpdateSchema = z.object({
  ...scopedUpdateFields,
  roleId: z.string().uuid().optional().nullable(),
})

export const bookingEventResourceCreateSchema = z.object({
  ...scopedCreateFields,
  eventId: z.string().uuid(),
  resourceId: z.string().uuid(),
  qty: z.coerce.number().int().positive().optional().default(1),
})

export const bookingEventResourceUpdateSchema = z.object({
  ...scopedUpdateFields,
  qty: z.coerce.number().int().positive().optional(),
})

export const bookingEventConfirmationCreateSchema = z.object({
  ...scopedCreateFields,
  eventId: z.string().uuid(),
  memberId: z.string().uuid(),
  status: confirmationStatusSchema.optional().default('pending'),
  respondedAt: z.coerce.date().optional().nullable(),
  note: z.string().optional().nullable(),
})

export const bookingEventConfirmationUpdateSchema = z.object({
  ...scopedUpdateFields,
  status: confirmationStatusSchema.optional(),
  respondedAt: z.coerce.date().optional().nullable(),
  note: z.string().optional().nullable(),
})

export const bookingServiceProductLinkCreateSchema = z.object({
  ...scopedCreateFields,
  serviceId: z.string().uuid(),
  productId: z.string().uuid(),
})

export const bookingServiceProductLinkUpdateSchema = z.object({
  ...scopedUpdateFields,
  serviceId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
})

export const bookingServiceVariantLinkCreateSchema = z.object({
  ...scopedCreateFields,
  serviceId: z.string().uuid(),
  variantId: z.string().uuid(),
})

export const bookingServiceVariantLinkUpdateSchema = z.object({
  ...scopedUpdateFields,
  serviceId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
})

export const bookingResourceTagCreateSchema = z.object({
  ...scopedCreateFields,
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/, 'Slug must be lowercase and may contain dashes or underscores'),
  label: z.string().trim().min(1).max(120),
  color: z.string().trim().max(30).optional(),
  description: z.string().trim().max(400).optional(),
})

export const bookingResourceTagUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(bookingResourceTagCreateSchema.partial())

export type BookingServiceCreateInput = z.infer<typeof bookingServiceCreateSchema>
export type BookingServiceUpdateInput = z.infer<typeof bookingServiceUpdateSchema>
export type BookingTeamRoleCreateInput = z.infer<typeof bookingTeamRoleCreateSchema>
export type BookingTeamRoleUpdateInput = z.infer<typeof bookingTeamRoleUpdateSchema>
export type BookingTeamMemberCreateInput = z.infer<typeof bookingTeamMemberCreateSchema>
export type BookingTeamMemberUpdateInput = z.infer<typeof bookingTeamMemberUpdateSchema>
export type BookingResourceTypeCreateInput = z.infer<typeof bookingResourceTypeCreateSchema>
export type BookingResourceTypeUpdateInput = z.infer<typeof bookingResourceTypeUpdateSchema>
export type BookingResourceCreateInput = z.infer<typeof bookingResourceCreateSchema>
export type BookingResourceUpdateInput = z.infer<typeof bookingResourceUpdateSchema>
export type BookingAvailabilityRuleCreateInput = z.infer<typeof bookingAvailabilityRuleCreateSchema>
export type BookingAvailabilityRuleUpdateInput = z.infer<typeof bookingAvailabilityRuleUpdateSchema>
export type BookingAvailabilityRuleSetCreateInput = z.infer<typeof bookingAvailabilityRuleSetCreateSchema>
export type BookingAvailabilityRuleSetUpdateInput = z.infer<typeof bookingAvailabilityRuleSetUpdateSchema>
export type BookingEventCreateInput = z.infer<typeof bookingEventCreateSchema>
export type BookingEventUpdateInput = z.infer<typeof bookingEventUpdateSchema>
export type BookingEventAttendeeCreateInput = z.infer<typeof bookingEventAttendeeCreateSchema>
export type BookingEventAttendeeUpdateInput = z.infer<typeof bookingEventAttendeeUpdateSchema>
export type BookingEventMemberCreateInput = z.infer<typeof bookingEventMemberCreateSchema>
export type BookingEventMemberUpdateInput = z.infer<typeof bookingEventMemberUpdateSchema>
export type BookingEventResourceCreateInput = z.infer<typeof bookingEventResourceCreateSchema>
export type BookingEventResourceUpdateInput = z.infer<typeof bookingEventResourceUpdateSchema>
export type BookingEventConfirmationCreateInput = z.infer<typeof bookingEventConfirmationCreateSchema>
export type BookingEventConfirmationUpdateInput = z.infer<typeof bookingEventConfirmationUpdateSchema>
export type BookingServiceProductLinkCreateInput = z.infer<typeof bookingServiceProductLinkCreateSchema>
export type BookingServiceProductLinkUpdateInput = z.infer<typeof bookingServiceProductLinkUpdateSchema>
export type BookingServiceVariantLinkCreateInput = z.infer<typeof bookingServiceVariantLinkCreateSchema>
export type BookingServiceVariantLinkUpdateInput = z.infer<typeof bookingServiceVariantLinkUpdateSchema>
export type BookingResourceTagCreateInput = z.infer<typeof bookingResourceTagCreateSchema>
export type BookingResourceTagUpdateInput = z.infer<typeof bookingResourceTagUpdateSchema>
