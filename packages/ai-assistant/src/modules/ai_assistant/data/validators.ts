import { z } from 'zod'

/**
 * Zod validators for the server-side AI chat conversation APIs.
 *
 * Spec: `2026-05-05-ai-chat-server-side-conversation-storage`. Used by the
 * REST routes under `api/ai/conversations/...` and by the repository to keep
 * input shapes aligned with the database constraints declared in
 * `data/entities.ts`.
 */

/** Page-context snapshot persisted on a conversation row. */
export const aiChatPageContextSchema = z
  .object({
    pageId: z.string().min(1).max(256).optional(),
    entityType: z.string().min(1).max(256).optional(),
    recordId: z.string().min(1).max(256).optional(),
  })
  .passthrough()

export type AiChatPageContextInput = z.infer<typeof aiChatPageContextSchema>

const aiAgentIdSchema = z
  .string()
  .trim()
  .min(1, 'agentId must be a non-empty string')
  .max(256, 'agentId exceeds the maximum length of 256 characters')

const conversationIdSchema = z
  .string()
  .trim()
  .min(1, 'conversationId must be a non-empty string')
  .max(128, 'conversationId exceeds the maximum length of 128 characters')

const titleSchema = z.string().trim().min(1).max(200)

/** `POST /api/ai_assistant/ai/conversations` */
export const aiChatConversationCreateSchema = z.object({
  agentId: aiAgentIdSchema,
  conversationId: conversationIdSchema.optional(),
  title: titleSchema.optional(),
  pageContext: aiChatPageContextSchema.nullable().optional(),
})

export type AiChatConversationCreateInput = z.infer<typeof aiChatConversationCreateSchema>

/** `GET /api/ai_assistant/ai/conversations?agent=&status=&limit=&cursor=` */
export const aiChatConversationListQuerySchema = z.object({
  agent: aiAgentIdSchema.optional(),
  status: z.enum(['open', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(200).optional(),
})

export type AiChatConversationListQuery = z.infer<typeof aiChatConversationListQuerySchema>

/** `PATCH /api/ai_assistant/ai/conversations/:conversationId` */
export const aiChatConversationUpdateSchema = z
  .object({
    title: titleSchema.nullable().optional(),
    status: z.enum(['open', 'closed']).optional(),
    pageContext: aiChatPageContextSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      typeof value.title !== 'undefined' ||
      typeof value.status !== 'undefined' ||
      typeof value.pageContext !== 'undefined',
    { message: 'At least one of title, status, or pageContext is required.' },
  )

export type AiChatConversationUpdateInput = z.infer<typeof aiChatConversationUpdateSchema>

const messageRoleSchema = z.enum(['user', 'assistant', 'system'])

/**
 * Shared message-body shape. `clientMessageId` is the idempotency key for
 * retries and lazy imports; `content` is capped to keep transcript rows
 * bounded; `uiParts` / `attachmentIds` / `files` accept the serializable
 * subset the chat UI already produces. Attachment previews (`data:` URLs
 * and transient blob URLs) MUST NOT pass through here — the UI strips them
 * before upload.
 */
const messageBaseSchema = z.object({
  clientMessageId: z.string().trim().min(1).max(128).optional(),
  role: messageRoleSchema,
  content: z.string().max(64_000),
  uiParts: z.array(z.unknown()).max(64).optional(),
  attachmentIds: z.array(z.string().trim().min(1).max(128)).max(32).optional(),
  files: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(128).optional(),
          name: z.string().trim().min(1).max(256).optional(),
          mimeType: z.string().trim().min(1).max(128).optional(),
          size: z.number().int().nonnegative().optional(),
        })
        .passthrough(),
    )
    .max(32)
    .optional(),
  model: z.string().trim().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/** `POST /api/ai_assistant/ai/conversations/import` */
export const aiChatConversationImportSchema = z.object({
  conversation: z.object({
    conversationId: conversationIdSchema,
    agentId: aiAgentIdSchema,
    title: titleSchema.optional(),
    status: z.enum(['open', 'closed']).optional(),
    pageContext: aiChatPageContextSchema.nullable().optional(),
  }),
  messages: z.array(messageBaseSchema).max(100),
})

export type AiChatConversationImportInput = z.infer<typeof aiChatConversationImportSchema>

/** Transcript GET query: `?limit=&before=` */
export const aiChatConversationTranscriptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().trim().min(1).max(200).optional(),
})

export type AiChatConversationTranscriptQuery = z.infer<
  typeof aiChatConversationTranscriptQuerySchema
>

/** Internal payload accepted by the repository when appending a single message. */
export const aiChatMessageAppendSchema = messageBaseSchema

export type AiChatMessageAppendInput = z.infer<typeof aiChatMessageAppendSchema>
