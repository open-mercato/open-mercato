import { z } from 'zod'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown) => (value === '' ? null : value)
const optionalText = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())
const optionalIsoDate = () =>
  z.preprocess(
    emptyStringToNull,
    z.string().trim().refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: 'Invalid date',
    }).nullable().optional(),
  )

const scopedIncidentSchema = z.object({
  id: uuid(),
  organizationId: uuid(),
  tenantId: uuid(),
})

const timelineKindSchema = z.enum([
  'note',
  'update',
  'ack',
  'status_change',
  'severity_change',
  'assignment',
  'escalation',
  'system',
  'merged_into',
  'merged_from',
  'reopened',
  'linked',
  'unlinked',
  'postmortem_published',
  'postmortem_updated',
])

const timelineKindsCsvSchema = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return value
  return value.split(',').map((kind) => kind.trim()).filter((kind) => kind.length > 0)
}, z.array(timelineKindSchema).min(1).optional())

export const timelineAddSchema = scopedIncidentSchema.extend({
  kind: z.enum(['note', 'update']).optional(),
  body: optionalText(8000),
  visibility: z.enum(['internal', 'customer_facing']).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type TimelineAddInput = z.infer<typeof timelineAddSchema>

export const timelineListSchema = scopedIncidentSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  kinds: timelineKindsCsvSchema,
  visibility: z.enum(['internal', 'customer_facing']).optional(),
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

export const postmortemUpsertSchema = scopedIncidentSchema.extend({
  summary: optionalText(20000),
  rootCause: optionalText(20000),
  impact: optionalText(20000),
  contributingFactors: optionalText(20000),
  lessons: optionalText(20000),
})

export type PostmortemUpsertInput = z.infer<typeof postmortemUpsertSchema>

export const postmortemPublishSchema = scopedIncidentSchema

export type PostmortemPublishInput = z.infer<typeof postmortemPublishSchema>

export const actionItemStatusSchema = z.enum(['open', 'in_progress', 'done', 'cancelled'])

export const actionItemCreateSchema = scopedIncidentSchema.extend({
  title: z.string().trim().min(1).max(300),
  description: optionalText(20000),
  assigneeUserId: uuid().nullable().optional(),
  dueAt: optionalIsoDate(),
})

export type ActionItemCreateInput = z.infer<typeof actionItemCreateSchema>

export const actionItemUpdateSchema = scopedIncidentSchema.extend({
  aid: uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  description: optionalText(20000),
  assigneeUserId: uuid().nullable().optional(),
  dueAt: optionalIsoDate(),
  status: actionItemStatusSchema.optional(),
})

export type ActionItemUpdateInput = z.infer<typeof actionItemUpdateSchema>

export const actionItemRemoveSchema = scopedIncidentSchema.extend({
  aid: uuid(),
})

export type ActionItemRemoveInput = z.infer<typeof actionItemRemoveSchema>

export const incidentLinkKindSchema = z.enum(['related', 'duplicate'])

export const incidentLinkCreateSchema = scopedIncidentSchema.extend({
  linkedIncidentId: uuid(),
  kind: incidentLinkKindSchema,
})

export type IncidentLinkCreateInput = z.infer<typeof incidentLinkCreateSchema>

export const incidentLinkRemoveSchema = scopedIncidentSchema.extend({
  lid: uuid(),
})

export type IncidentLinkRemoveInput = z.infer<typeof incidentLinkRemoveSchema>

export const incidentMergeSchema = scopedIncidentSchema.extend({
  targetIncidentId: uuid(),
})

export type IncidentMergeInput = z.infer<typeof incidentMergeSchema>
