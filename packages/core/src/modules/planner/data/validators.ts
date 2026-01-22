import { z } from 'zod'

const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid ISO date string',
})

const availabilitySubjectSchema = z.enum(['member', 'resource', 'ruleset'])
const availabilityKindSchema = z.enum(['availability', 'unavailability'])

const scopedCreateFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
}

const scopedUpdateFields = {
  id: z.string().uuid(),
}

export const plannerAvailabilityRuleSetCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  timezone: z.string().min(1),
})

export const plannerAvailabilityRuleSetUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  timezone: z.string().min(1).optional(),
})

export const plannerAvailabilityRuleCreateSchema = z.object({
  ...scopedCreateFields,
  subjectType: availabilitySubjectSchema,
  subjectId: z.string().uuid(),
  timezone: z.string().min(1),
  rrule: z.string().min(1),
  exdates: z.array(isoDateString).optional().default([]),
  kind: availabilityKindSchema.optional().default('availability'),
  note: z.string().trim().max(200).optional().nullable(),
  unavailabilityReasonEntryId: z.string().uuid().optional().nullable(),
  unavailabilityReasonValue: z.string().trim().min(1).max(150).optional().nullable(),
})

export const plannerAvailabilityRuleUpdateSchema = z.object({
  ...scopedUpdateFields,
  subjectType: availabilitySubjectSchema.optional(),
  subjectId: z.string().uuid().optional(),
  timezone: z.string().min(1).optional(),
  rrule: z.string().min(1).optional(),
  exdates: z.array(isoDateString).optional(),
  kind: availabilityKindSchema.optional(),
  note: z.string().trim().max(200).optional().nullable(),
  unavailabilityReasonEntryId: z.string().uuid().optional().nullable(),
  unavailabilityReasonValue: z.string().trim().min(1).max(150).optional().nullable(),
})

const weeklyWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const dateSpecificWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const dateSpecificDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const plannerAvailabilityWeeklyReplaceSchema = z.object({
  ...scopedCreateFields,
  subjectType: availabilitySubjectSchema,
  subjectId: z.string().uuid(),
  timezone: z.string().min(1),
  windows: z.array(weeklyWindowSchema).default([]),
})

export type PlannerAvailabilityWeeklyReplaceInput = z.infer<typeof plannerAvailabilityWeeklyReplaceSchema>

export const plannerAvailabilityDateSpecificReplaceSchema = z.object({
  ...scopedCreateFields,
  subjectType: availabilitySubjectSchema,
  subjectId: z.string().uuid(),
  timezone: z.string().min(1),
  date: dateSpecificDateSchema.optional(),
  dates: z.array(dateSpecificDateSchema).optional(),
  windows: z.array(dateSpecificWindowSchema).default([]),
  isAvailable: z.boolean().default(true),
  kind: availabilityKindSchema.optional(),
  note: z.string().trim().max(200).optional().nullable(),
  unavailabilityReasonEntryId: z.string().uuid().optional().nullable(),
  unavailabilityReasonValue: z.string().trim().min(1).max(150).optional().nullable(),
}).superRefine((value, ctx) => {
  const hasDate = typeof value.date === 'string' && value.date.length > 0
  const hasDates = Array.isArray(value.dates) && value.dates.length > 0
  if (!hasDate && !hasDates) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['date'],
      message: 'Date is required.',
    })
  }
})

export type PlannerAvailabilityDateSpecificReplaceInput = z.infer<typeof plannerAvailabilityDateSpecificReplaceSchema>

export type PlannerAvailabilityRuleSetCreateInput = z.infer<typeof plannerAvailabilityRuleSetCreateSchema>
export type PlannerAvailabilityRuleSetUpdateInput = z.infer<typeof plannerAvailabilityRuleSetUpdateSchema>
export type PlannerAvailabilityRuleCreateInput = z.infer<typeof plannerAvailabilityRuleCreateSchema>
export type PlannerAvailabilityRuleUpdateInput = z.infer<typeof plannerAvailabilityRuleUpdateSchema>
