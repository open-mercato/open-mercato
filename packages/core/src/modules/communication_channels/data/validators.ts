import { z } from 'zod'

/**
 * Zod schemas for adapter inputs and API request/response bodies.
 *
 * These mirror the TypeScript interfaces in `lib/adapter.ts`. They are used by:
 *   - API route handlers to validate incoming requests
 *   - Adapter implementations that prefer runtime validation over TypeScript-only types
 *   - `validateCredentials?(...)` flow on credential-based providers
 */

export const tenantScopeSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid(),
})

export const channelCapabilitiesSchema = z.object({
  threading: z.boolean(),
  richText: z.boolean(),
  fileSharing: z.boolean(),
  maxFileSize: z.number().int().nonnegative().optional(),
  supportedMimeTypes: z.array(z.string()).optional(),
  readReceipts: z.boolean(),
  deliveryReceipts: z.boolean(),
  typingIndicators: z.boolean(),
  reactions: z.boolean(),
  multiReactionPerUser: z.boolean(),
  editMessage: z.boolean(),
  deleteMessage: z.boolean(),
  presence: z.boolean(),
  richBlocks: z.boolean(),
  interactiveComponents: z.boolean(),
  inlineImages: z.boolean(),
  conversationHistory: z.boolean(),
  contactCards: z.boolean(),
  locationSharing: z.boolean(),
  voiceNotes: z.boolean(),
  stickers: z.boolean(),
  supportedBodyFormats: z.array(z.enum(['text', 'markdown', 'html'])),
  maxBodyLength: z.number().int().positive().optional(),
  realtimePush: z.boolean().optional(),
})

export const normalizedAttachmentSchema = z.object({
  url: z.string().url(),
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().nonnegative().optional(),
  inline: z.boolean().optional(),
})

export const messageContentSchema = z.object({
  text: z.string().optional(),
  html: z.string().optional(),
  bodyFormat: z.enum(['text', 'markdown', 'html']).optional(),
  attachments: z.array(normalizedAttachmentSchema).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
})

export const sendMessageInputSchema = z.object({
  conversationId: z.string().optional(),
  content: messageContentSchema,
  credentials: z.record(z.string(), z.unknown()),
  scope: tenantScopeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const validateCredentialsInputSchema = z.object({
  providerKey: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()),
  scope: tenantScopeSchema,
})

export const validateCredentialsResultSchema = z.object({
  ok: z.boolean(),
  errors: z.record(z.string(), z.string()).optional(),
})

export const refreshCredentialsInputSchema = z.object({
  channelId: z.string().uuid(),
  credentials: z.record(z.string(), z.unknown()),
  scope: tenantScopeSchema,
})

export const refreshedCredentialsSchema = z.object({
  credentials: z.record(z.string(), z.unknown()),
  expiresAt: z.date().optional(),
})

export const inboundReactionSchema = z.object({
  emoji: z.string().min(1),
  userIdentifier: z.string().min(1),
  userDisplayName: z.string().optional(),
  timestamp: z.date().optional(),
})

/**
 * Canonical normalized inbound reaction event — matches `InboundReactionEvent`
 * in `lib/adapter.ts`. Used by the reactions queue for type-safe payloads.
 */
export const inboundReactionEventSchema = z.object({
  externalMessageId: z.string().min(1),
  externalConversationId: z.string().min(1).optional(),
  externalReactionId: z.string().min(1).optional(),
  emoji: z.string().min(1).max(64),
  userIdentifier: z.string().min(1),
  userDisplayName: z.string().optional(),
  action: z.enum(['added', 'removed']),
  timestamp: z.date().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
})

export const normalizedInboundMessageSchema = z.object({
  externalMessageId: z.string().min(1),
  externalConversationId: z.string().min(1),
  senderIdentifier: z.string().min(1),
  senderDisplayName: z.string().optional(),
  senderAvatarUrl: z.string().url().optional(),
  subject: z.string().optional(),
  body: z.string(),
  bodyFormat: z.enum(['text', 'markdown', 'html']),
  attachments: z.array(normalizedAttachmentSchema).optional(),
  timestamp: z.date(),
  replyToExternalId: z.string().optional(),
  channelPayload: z.record(z.string(), z.unknown()),
  channelContentType: z.string().min(1),
  channelMetadata: z.record(z.string(), z.unknown()),
  reactions: z.array(inboundReactionSchema).optional(),
})

export const reactionApiBodySchema = z.object({
  emoji: z.string().min(1).max(64),
})

export type SendMessageInputDto = z.infer<typeof sendMessageInputSchema>
export type NormalizedInboundMessageDto = z.infer<typeof normalizedInboundMessageSchema>
export type ChannelCapabilitiesDto = z.infer<typeof channelCapabilitiesSchema>
export type ReactionApiBodyDto = z.infer<typeof reactionApiBodySchema>
