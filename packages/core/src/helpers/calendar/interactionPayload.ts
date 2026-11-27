import { z } from 'zod'

const calendarParticipantSchema = z
  .object({
    userId: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough()

export const calendarInteractionPayloadSchema = z
  .object({
    id: z.string(),
    interactionType: z.string(),
    title: z.string().nullable().optional(),
    status: z.string(),
    scheduledAt: z.string().nullable().optional(),
    occurredAt: z.string().nullable().optional(),
    durationMinutes: z.number().nullable().optional(),
    timezone: z.string().nullable().optional(),
    allDay: z.boolean().nullable().optional(),
    location: z.string().nullable().optional(),
    participants: z.array(calendarParticipantSchema).nullable().optional(),
    recurrenceRule: z.string().nullable().optional(),
    recurrenceEnd: z.string().nullable().optional(),
    appearanceIcon: z.string().nullable().optional(),
    appearanceColor: z.string().nullable().optional(),
    ownerUserId: z.string().nullable().optional(),
    entityId: z.string().nullable().optional(),
    dealId: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

export type CalendarInteractionPayload = z.infer<typeof calendarInteractionPayloadSchema>
