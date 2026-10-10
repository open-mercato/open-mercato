import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadMapping, ExternalConversation } from '../data/entities'

/**
 * Prefix of the placeholder conversation ref `sendAsUser` mints for a thread
 * the provider has not seen yet (`outbound:<messageThreadId>`). It stands in
 * until the first send tells us the provider's own conversation id.
 */
export const OUTBOUND_CONVERSATION_REF_PREFIX = 'outbound:'

export function buildOutboundConversationRef(messageThreadId: string): string {
  return `${OUTBOUND_CONVERSATION_REF_PREFIX}${messageThreadId}`
}

export function isOutboundConversationRef(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith(OUTBOUND_CONVERSATION_REF_PREFIX)
}

export type AdoptProviderConversationRefResult = 'adopted' | 'unchanged' | 'conflict'

/**
 * After a successful send, re-key a hub-minted `outbound:` conversation to the
 * conversation id the provider reported (`SendMessageResult.conversationId`,
 * in the same format the adapter's inbound normalizer produces, e.g.
 * `gmail-thread:<threadId>`). Without this, the provider's copy of the sent
 * message and every reply to it arrive under the provider's id, open a second
 * conversation, and the CRM shows the exchange as two threads.
 *
 * No-op unless the mapping still carries an `outbound:` placeholder and the
 * provider returned a different, non-empty ref. When another conversation on
 * the same channel already owns that ref (an inbound message raced the send),
 * it is left alone and `conflict` is returned: merging two live conversations
 * is not this helper's job.
 */
export async function adoptProviderConversationRef(
  em: EntityManager,
  args: {
    mapping: ChannelThreadMapping
    channelId: string
    providerConversationRef: string | null | undefined
    scope: { tenantId: string; organizationId: string | null }
  },
): Promise<AdoptProviderConversationRefResult> {
  const nextRef = typeof args.providerConversationRef === 'string' ? args.providerConversationRef.trim() : ''
  if (!nextRef || nextRef === args.mapping.externalThreadRef) return 'unchanged'
  if (!isOutboundConversationRef(args.mapping.externalThreadRef)) return 'unchanged'
  if (isOutboundConversationRef(nextRef)) return 'unchanged'

  const dscope = { tenantId: args.scope.tenantId, organizationId: args.scope.organizationId }
  const conversation = await findOneWithDecryption(
    em,
    ExternalConversation,
    {
      id: args.mapping.externalConversationId,
      channelId: args.channelId,
      tenantId: args.scope.tenantId,
      organizationId: args.scope.organizationId,
    },
    undefined,
    dscope,
  )
  if (!conversation || !isOutboundConversationRef(conversation.externalConversationId)) return 'unchanged'

  const owner = await findOneWithDecryption(
    em,
    ExternalConversation,
    {
      channelId: args.channelId,
      externalConversationId: nextRef,
      tenantId: args.scope.tenantId,
      organizationId: args.scope.organizationId,
    },
    undefined,
    dscope,
  )
  if (owner) return 'conflict'

  conversation.externalConversationId = nextRef
  args.mapping.externalThreadRef = nextRef
  await em.flush()
  return 'adopted'
}
