import { z } from 'zod'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown) => (value === '' ? null : value)
const optionalText = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const scopedIncidentSchema = z.object({
  id: uuid(),
  organizationId: uuid(),
  tenantId: uuid(),
})

export const timelineAddSchema = scopedIncidentSchema.extend({
  kind: z.enum(['note', 'update']).optional(),
  body: optionalText(8000),
  visibility: z.enum(['internal', 'customer_facing']).optional(),
})

export type TimelineAddInput = z.infer<typeof timelineAddSchema>

export const timelineListSchema = scopedIncidentSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export type TimelineListInput = z.infer<typeof timelineListSchema>

export const participantAddSchema = scopedIncidentSchema.extend({
  userId: uuid(),
  kind: z.enum(['responder', 'subscriber']),
  roleId: uuid().nullable().optional(),
})

export type ParticipantAddInput = z.infer<typeof participantAddSchema>

export const participantUpdateSchema = scopedIncidentSchema.extend({
  pid: uuid(),
  roleId: uuid().nullable(),
})

export type ParticipantUpdateInput = z.infer<typeof participantUpdateSchema>

export const participantRemoveSchema = scopedIncidentSchema.extend({
  pid: uuid(),
})

export type ParticipantRemoveInput = z.infer<typeof participantRemoveSchema>
