import { z } from 'zod'

const uuid = () => z.string().uuid()

export const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

export const phoneCallDirectionSchema = z.enum([
  'inbound',
  'outbound',
  'internal',
  'unknown',
])

export const phoneCallStatusSchema = z.enum([
  'new',
  'ringing',
  'answered',
  'missed',
  'failed',
  'completed',
  'unknown',
])

export const phoneCallParticipantRoleSchema = z.enum([
  'caller',
  'callee',
  'agent',
  'unknown',
])

export const ingestParticipantSchema = z.object({
  role: phoneCallParticipantRoleSchema,
  providerParticipantId: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  displayName: z.string().nullish(),
  email: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ingestRecordingSchema = z.object({
  url: z.string().nullish(),
  providerRecordingId: z.string().nullish(),
  mimeType: z.string().nullish(),
  durationSeconds: z.number().int().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ingestPhoneCallSchema = scopedSchema.extend({
  providerKey: z.string().min(1),
  integrationId: z.string().nullish(),
  externalCallId: z.string().min(1),
  externalConversationId: z.string().nullish(),
  direction: phoneCallDirectionSchema,
  status: phoneCallStatusSchema,
  participants: z.array(ingestParticipantSchema).default([]),
  recording: ingestRecordingSchema.nullish(),
  startedAt: z.coerce.date().nullish(),
  answeredAt: z.coerce.date().nullish(),
  endedAt: z.coerce.date().nullish(),
  durationSeconds: z.number().int().nullish(),
  providerFacts: z.record(z.string(), z.unknown()).optional(),
  rawPayload: z.record(z.string(), z.unknown()),
})

export type IngestPhoneCallInput = z.infer<typeof ingestPhoneCallSchema>
export type IngestParticipantInput = z.infer<typeof ingestParticipantSchema>
