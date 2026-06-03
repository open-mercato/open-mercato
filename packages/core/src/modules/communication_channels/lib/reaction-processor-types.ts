import type { InboundReactionEvent } from './adapter'

/**
 * Discriminated union of reaction-queue job payloads.
 *
 * Split into its own file so command modules can reference these types without
 * forming a circular import with the worker module (which references commands).
 */

export type ReactionScope = {
  tenantId: string
  organizationId: string | null
}

export type ReactionJobBase = {
  providerKey: string
  channelId: string
  scope: ReactionScope
  /** Attempt number, 1-based. */
  attempt?: number
}

export type ReactionInboundJob = ReactionJobBase & {
  kind: 'inbound'
  channelType: string
  event: InboundReactionEvent
}

export type ReactionOutboundSendJob = ReactionJobBase & {
  kind: 'outbound_send'
  messageId: string
  reactionId: string
  emoji: string
  /** External conversation reference for the provider call (e.g. Slack thread_ts). */
  conversationId?: string
}

export type ReactionOutboundRemoveJob = ReactionJobBase & {
  kind: 'outbound_remove'
  messageId: string
  emoji: string
  externalReactionId: string | null
  conversationId?: string
}

export type ReactionProcessorPayload =
  | ReactionInboundJob
  | ReactionOutboundSendJob
  | ReactionOutboundRemoveJob

export const REACTION_PROCESSOR_MAX_ATTEMPTS = 3
