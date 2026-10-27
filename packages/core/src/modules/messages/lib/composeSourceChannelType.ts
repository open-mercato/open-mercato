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

/**
 * Whether the compose validator can consult a resolved channel type at all.
 *
 * `sourceChannelType` is read in exactly one branch — a non-draft, public
 * message that carries no address. Every internal reply, every draft and every
 * public message that already supplies an address ignores it, so resolving it
 * for them is a DI resolve plus a database round-trip whose answer is
 * discarded. Mirrors `refineComposeMessage` and reads the raw body defensively,
 * because this runs before validation. Skipping resolution yields `undefined`,
 * which is already the fail-closed value.
 */
export function composeRequiresChannelTypeResolution(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const raw = body as Record<string, unknown>
  if (raw.visibility !== 'public') return false
  if (raw.isDraft === true) return false
  const externalEmail = raw.externalEmail
  return !(typeof externalEmail === 'string' && externalEmail.trim().length > 0)
}

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
