import { z } from 'zod'

/**
 * Entity type a channel-backed conversation is exposed under on a message's
 * `sourceEntityType`. Written by `communication_channels`' inbound ingest.
 */
const EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE = 'communication_channels.external_conversation'

/**
 * The only parts of a compose body this resolution needs. Read defensively from
 * the raw request body, before the body is validated, because the validation
 * outcome itself depends on the answer (#4975).
 */
export const composeSourceHintSchema = z.object({
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  parentMessageId: z.string().uuid().optional(),
})

export type ComposeSourceHint = z.infer<typeof composeSourceHintSchema>

type ResolveChannelTypeService = (
  container: ContainerLike,
  scope: { tenantId: string; organizationId: string | null },
  reference: { externalConversationId?: string | null; messageId?: string | null },
) => Promise<string | null>

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

function tryResolveChannelTypeService(
  container: ContainerLike,
): ResolveChannelTypeService | undefined {
  try {
    return container.resolve<ResolveChannelTypeService>('communicationChannelsResolveChannelType')
  } catch {
    // `communication_channels` is optional: without it no message can originate
    // from a channel, so "unknown" is both correct and fail-closed.
    return undefined
  }
}

/**
 * Resolve the channel type a compose request originates from, server-side.
 *
 * Never derived from the request body's own `sourceChannelType` — that would let
 * any caller waive the `externalEmail` requirement by asserting a channel type.
 * It is looked up from the conversation the message is being composed on, or
 * from the parent message it replies to.
 *
 * Returns `undefined` when nothing can be established, which the compose
 * validator treats as "unknown" and therefore keeps the pre-#4975 rule.
 */
export async function resolveComposeSourceChannelType(
  container: ContainerLike,
  scope: { tenantId: string; organizationId: string | null },
  hint: ComposeSourceHint,
): Promise<string | undefined> {
  const externalConversationId =
    hint.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE
      ? hint.sourceEntityId ?? null
      : null
  const messageId = hint.parentMessageId ?? null
  if (!externalConversationId && !messageId) return undefined

  const resolveChannelType = tryResolveChannelTypeService(container)
  if (!resolveChannelType) return undefined

  const channelType = await resolveChannelType(container, scope, {
    externalConversationId,
    messageId,
  })
  return channelType ?? undefined
}

export { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }
