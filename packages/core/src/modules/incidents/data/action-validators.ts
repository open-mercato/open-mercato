import { z } from 'zod'

const uuid = () => z.string().uuid()

export const incidentStatusSchema = z.enum([
  'open',
  'investigating',
  'identified',
  'mitigated',
  'resolved',
  'closed',
])

const scopedIncidentActionSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
  id: uuid(),
})

const actionFieldsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)

export const acknowledgeSchema = scopedIncidentActionSchema

export type IncidentAcknowledgeInput = z.infer<typeof acknowledgeSchema>

export const transitionSchema = scopedIncidentActionSchema.extend({
  status: incidentStatusSchema,
  fields: actionFieldsSchema.optional(),
})

export type IncidentTransitionInput = z.infer<typeof transitionSchema>

export const changeSeveritySchema = scopedIncidentActionSchema.extend({
  severityId: uuid(),
})

export type IncidentChangeSeverityInput = z.infer<typeof changeSeveritySchema>

export const assignSchema = scopedIncidentActionSchema.extend({
  ownerUserId: uuid().nullable().optional(),
  owningTeamId: uuid().nullable().optional(),
})

export type IncidentAssignInput = z.infer<typeof assignSchema>

export const escalateSchema = scopedIncidentActionSchema

export type IncidentEscalateInput = z.infer<typeof escalateSchema>

export const snoozeSchema = scopedIncidentActionSchema.extend({
  until: z.string().trim().min(1).refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'Invalid date',
  }),
})

export type IncidentSnoozeInput = z.infer<typeof snoozeSchema>

export type IncidentActionInput =
  | IncidentAcknowledgeInput
  | IncidentTransitionInput
  | IncidentChangeSeverityInput
  | IncidentAssignInput
  | IncidentEscalateInput
  | IncidentSnoozeInput
