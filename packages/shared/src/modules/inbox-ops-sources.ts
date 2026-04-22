import { z } from 'zod'

export const INBOX_OPS_SOURCE_BODY_HARD_LIMIT = 200_000

const uuidSchema = z.string().uuid()
const openTokenSchema = z.string().trim().min(1).max(200)
const titleSchema = z.string().trim().min(1).max(500)
const timelineTextSchema = z.string().trim().min(1).max(10_000)
const attachmentTextSchema = z.string().trim().min(1).max(20_000)
const primitiveValueSchema = z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])
const shallowSerializableValueSchema = z.union([
  primitiveValueSchema,
  z.array(primitiveValueSchema).max(50),
])

function recordWithMaxKeys<T extends z.ZodTypeAny>(
  valueSchema: T,
  maxKeys: number,
) {
  return z.record(z.string(), valueSchema).superRefine((value, ctx) => {
    if (Object.keys(value).length > maxKeys) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected at most ${maxKeys} keys`,
      })
    }
  })
}

export const inboxOpsSourceDescriptorSchema = z.object({
  sourceEntityType: openTokenSchema,
  sourceEntityId: uuidSchema,
  sourceArtifactId: uuidSchema.optional(),
  sourceVersion: z.string().trim().min(1).max(255).optional(),
  tenantId: uuidSchema,
  organizationId: uuidSchema,
  requestedByUserId: uuidSchema.nullable().optional(),
  triggerEventId: z.string().trim().min(1).max(255).optional(),
})

export const normalizedInboxOpsParticipantSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  displayName: z.string().trim().min(1).max(300).optional(),
  email: z.string().trim().email().max(320).optional(),
  phoneNumber: z.string().trim().min(1).max(50).optional(),
  role: openTokenSchema.optional(),
})

export const normalizedInboxOpsTimelineEntrySchema = z.object({
  timestamp: z.string().trim().min(1).max(100).optional(),
  actorIdentifier: z.string().trim().min(1).max(320),
  actorLabel: z.string().trim().min(1).max(300).optional(),
  direction: openTokenSchema.optional(),
  text: timelineTextSchema,
})

export const normalizedInboxOpsAttachmentSchema = z.object({
  kind: openTokenSchema.optional(),
  fileName: z.string().trim().min(1).max(500).optional(),
  mimeType: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().url().max(2000).optional(),
  extractedText: attachmentTextSchema.optional(),
})

export const normalizedInboxOpsCapabilitiesSchema = z.object({
  canDraftReply: z.boolean(),
  replyChannelType: openTokenSchema.optional(),
  canUseTimelineContext: z.boolean(),
})

export const normalizedInboxOpsInputSchema = z.object({
  sourceEntityType: openTokenSchema,
  sourceEntityId: uuidSchema,
  sourceArtifactId: uuidSchema.optional(),
  sourceVersion: z.string().trim().min(1).max(255).optional(),
  title: titleSchema.optional(),
  body: z.string().trim().min(1).max(INBOX_OPS_SOURCE_BODY_HARD_LIMIT),
  bodyFormat: openTokenSchema,
  participants: z.array(normalizedInboxOpsParticipantSchema).max(50),
  timeline: z.array(normalizedInboxOpsTimelineEntrySchema).max(200).optional(),
  attachments: z.array(normalizedInboxOpsAttachmentSchema).max(50).optional(),
  capabilities: normalizedInboxOpsCapabilitiesSchema,
  facts: recordWithMaxKeys(primitiveValueSchema, 100).optional(),
  sourceMetadata: recordWithMaxKeys(shallowSerializableValueSchema, 100).optional(),
})

export const inboxOpsSourcePromptHintsSchema = z.object({
  sourceLabel: z.string().trim().min(1).max(200),
  sourceKind: openTokenSchema,
  primaryEvidence: z.array(z.string().trim().min(1).max(100)).max(10),
  participantIdentityMode: openTokenSchema,
  replySupport: openTokenSchema,
  extraInstructions: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
})

export const inboxOpsSourceSubmissionRequestedSchema = z.object({
  submissionId: uuidSchema.optional(),
  descriptor: inboxOpsSourceDescriptorSchema,
  legacyInboxEmailId: uuidSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  initialNormalizedInput: normalizedInboxOpsInputSchema.nullable().optional(),
  initialSourceSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type InboxOpsSourceDescriptor = z.infer<typeof inboxOpsSourceDescriptorSchema>
export type NormalizedInboxOpsParticipant = z.infer<typeof normalizedInboxOpsParticipantSchema>
export type NormalizedInboxOpsTimelineEntry = z.infer<typeof normalizedInboxOpsTimelineEntrySchema>
export type NormalizedInboxOpsAttachment = z.infer<typeof normalizedInboxOpsAttachmentSchema>
export type NormalizedInboxOpsCapabilities = z.infer<typeof normalizedInboxOpsCapabilitiesSchema>
export type NormalizedInboxOpsInput = z.infer<typeof normalizedInboxOpsInputSchema>
export type InboxOpsSourcePromptHints = z.infer<typeof inboxOpsSourcePromptHintsSchema>
export type InboxOpsSourceSubmissionRequested = z.infer<typeof inboxOpsSourceSubmissionRequestedSchema>

export interface InboxOpsSourceAdapterContext {
  resolve: <T = unknown>(name: string) => T
}

export interface InboxOpsSourceAdapter<TLoaded = unknown> {
  sourceEntityType: string
  displayKind?: string
  displayIcon?: string
  loadSource(args: InboxOpsSourceDescriptor, ctx: InboxOpsSourceAdapterContext): Promise<TLoaded>
  assertReady?(
    loaded: TLoaded,
    args: InboxOpsSourceDescriptor,
    ctx: InboxOpsSourceAdapterContext,
  ): Promise<void> | void
  getVersion?(
    loaded: TLoaded,
    args: InboxOpsSourceDescriptor,
    ctx: InboxOpsSourceAdapterContext,
  ): Promise<string | null> | string | null
  buildInput(
    loaded: TLoaded,
    args: InboxOpsSourceDescriptor,
    ctx: InboxOpsSourceAdapterContext,
  ): Promise<NormalizedInboxOpsInput> | NormalizedInboxOpsInput
  buildPromptHints?(
    loaded: TLoaded,
    args: InboxOpsSourceDescriptor,
    ctx: InboxOpsSourceAdapterContext,
  ): Promise<InboxOpsSourcePromptHints | null> | InboxOpsSourcePromptHints | null
  buildSnapshot?(
    loaded: TLoaded,
    args: InboxOpsSourceDescriptor,
    ctx: InboxOpsSourceAdapterContext,
  ): Promise<Record<string, unknown> | null> | Record<string, unknown> | null
}
