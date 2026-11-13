import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUniqueViolation } from '@open-mercato/shared/lib/db/pg-errors'
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
 * provider returned a different, non-empty ref.
 *
 * The placeholder-to-provider transition is atomic: the conversation and the
 * mapping are read with `PESSIMISTIC_WRITE` (always conversation first, then
 * mapping, so two adopters cannot deadlock) inside one transaction, and the
 * placeholder check runs on those locked rows. Two delivery workers adopting
 * the same placeholder are serialized: the first commits its provider ref, the
 * second blocks on the lock, re-reads the committed rows and returns
 * `unchanged` when the stored ref is the one it would write, or `conflict`
 * when it is a different provider ref. A loser never overwrites the winner.
 *
 * `conflict` is also returned when another conversation on the same channel
 * already owns the provider ref (an inbound message raced the send): merging
 * two live conversations is not this helper's job. The same holds when that
 * owner is inserted between the lookup and the flush: the unique violation on
 * `external_conversations_channel_external_uq` rolls the transaction back and
 * is reported as `conflict` too. On `conflict` the caller keeps the delivered
 * message's own provider identifiers (they live on its link and external
 * message, not on the shared conversation).
 *
 * The work runs on a fork of `em`, so a failed transaction never leaves the
 * caller's entity manager holding dirty state; the caller's `mapping` is
 * updated only after this call's own transaction committed.
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
  const isolated = em.fork()
  let result: AdoptProviderConversationRefResult
  try {
    result = await isolated.transactional(async (tx) => {
      const conversation = await findOneWithDecryption(
        tx,
        ExternalConversation,
        {
          id: args.mapping.externalConversationId,
          channelId: args.channelId,
          tenantId: args.scope.tenantId,
          organizationId: args.scope.organizationId,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        dscope,
      )
      if (!conversation) return 'unchanged'
      if (!isOutboundConversationRef(conversation.externalConversationId)) {
        return settledRefOutcome(conversation.externalConversationId, nextRef)
      }

      const owner = await findOneWithDecryption(
        tx,
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

      const mapping = await findOneWithDecryption(
        tx,
        ChannelThreadMapping,
        {
          id: args.mapping.id,
          channelId: args.channelId,
          tenantId: args.scope.tenantId,
          organizationId: args.scope.organizationId,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        dscope,
      )
      if (!mapping) return 'unchanged'
      if (!isOutboundConversationRef(mapping.externalThreadRef)) {
        return settledRefOutcome(mapping.externalThreadRef, nextRef)
      }

      conversation.externalConversationId = nextRef
      mapping.externalThreadRef = nextRef
      await tx.flush()
      return 'adopted'
    })
  } catch (error) {
    if (isUniqueViolation(error)) return 'conflict'
    throw error
  }
  if (result === 'adopted') args.mapping.externalThreadRef = nextRef
  return result
}

/**
 * Outcome for an adopter that finds the locked row already re-keyed by
 * another one: the same provider ref is a no-op, a different one is a
 * `conflict` the caller must not overwrite.
 */
function settledRefOutcome(storedRef: string | null | undefined, nextRef: string): AdoptProviderConversationRefResult {
  return storedRef === nextRef ? 'unchanged' : 'conflict'
}
