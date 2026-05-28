import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CommunicationChannel,
  ExternalConversation,
  ExternalMessage,
  MessageChannelLink,
} from '../data/entities'

/**
 * Hub-side mutation guards (Phase 4 of the email integration spec).
 *
 * These guards are plain functions that any caller (CRUD route, command,
 * subscriber) can invoke to enforce hub invariants before mutating state.
 * They throw `ChannelMutationBlockedError` on violations so the caller can
 * map the error to an HTTP 4xx (typically 422) without leaking internals.
 *
 * Why functions, not the generic `validateCrudMutationGuard`:
 *   The hub's writes are channel-shaped rather than entity-shaped — "deleting a
 *   channel with unread inbound" is not a per-entity invariant the generic
 *   CRUD guard layer can express. These functions encode hub semantics directly
 *   and stay invocation-site agnostic.
 */

export type ChannelMutationGuardReason =
  | 'channel_has_inbound_history'
  | 'channel_requires_reauth'
  | 'channel_disconnected'
  | 'channel_not_found'
  /**
   * @deprecated Use `channel_has_inbound_history`. Kept for one minor release
   * so external callers/tests catch a transition window. Round-2 F8 rename.
   */
  | 'channel_has_unread_inbound'

export class ChannelMutationBlockedError extends Error {
  readonly reason: ChannelMutationGuardReason
  readonly channelId: string
  /** Field-level error message keyed by `channelId` — for `createCrudFormError`. */
  readonly errors: Record<string, string>

  constructor(reason: ChannelMutationGuardReason, channelId: string, message: string) {
    super(message)
    this.name = 'ChannelMutationBlockedError'
    this.reason = reason
    this.channelId = channelId
    this.errors = { channelId: message }
  }
}

export interface ChannelScope {
  tenantId: string
  organizationId?: string | null
}

export interface GuardChannelDeleteInput {
  channelId: string
  scope: ChannelScope
  /** Bypass the unread-inbound check; used by admin "force delete" actions. */
  force?: boolean
}

/**
 * Guard `channel.delete`.
 *
 * Blocks when the channel still has ANY inbound `MessageChannelLink` rows.
 * Implementation note: the hub doesn't track per-message read state — that
 * lives on the messages module's `MessageRecipient.read_at`. Counting unread
 * across the module boundary would require either raw cross-module SQL
 * (forbidden by AGENTS.md) or a QueryEngine round-trip per delete. We pick
 * the simpler safety contract: block delete when ANY inbound link exists,
 * with `force: true` as the escape hatch.
 *
 * Pass `force: true` to bypass — exposed to admins so they can hard-delete a
 * channel whose mailbox they no longer care about (e.g. ex-employee
 * offboarding).
 */
export async function guardChannelDelete(
  em: EntityManager,
  input: GuardChannelDeleteInput,
): Promise<void> {
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: input.channelId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    input.scope,
  )
  if (!channel) {
    throw new ChannelMutationBlockedError(
      'channel_not_found',
      input.channelId,
      'Channel not found in this tenant scope.',
    )
  }
  if (input.force) return

  const inboundCount = await countInboundLinksForChannel(em, input.channelId, input.scope)
  if (inboundCount > 0) {
    throw new ChannelMutationBlockedError(
      'channel_has_inbound_history',
      input.channelId,
      `Channel has ${inboundCount} inbound message${inboundCount === 1 ? '' : 's'} in history. Pass force=true to delete anyway.`,
    )
  }
}

export interface GuardOutboundCreateInput {
  channelId: string
  scope: ChannelScope
}

/**
 * Guard `message.create` for outbound sends.
 *
 * Blocks when the target channel is in `requires_reauth` or `disconnected` —
 * outbound sends through a re-auth-needed channel will fail at the provider
 * anyway, and blocking here gives a deterministic 422 with a field-level error
 * instead of an opaque 500. The hub's `mark_channel_requires_reauth` command
 * sets the status when refresh fails (slice 3b).
 */
export async function guardOutboundCreate(
  em: EntityManager,
  input: GuardOutboundCreateInput,
): Promise<void> {
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: input.channelId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    input.scope,
  )
  if (!channel) {
    throw new ChannelMutationBlockedError(
      'channel_not_found',
      input.channelId,
      'Channel not found in this tenant scope.',
    )
  }
  if (channel.status === 'requires_reauth') {
    throw new ChannelMutationBlockedError(
      'channel_requires_reauth',
      input.channelId,
      'This channel needs reconnection before it can send messages. Open Profile -> Communication channels to reconnect.',
    )
  }
  if (channel.status === 'disconnected') {
    throw new ChannelMutationBlockedError(
      'channel_disconnected',
      input.channelId,
      'This channel is disconnected and cannot send messages.',
    )
  }
}

/**
 * Returns the count of inbound `MessageChannelLink` rows the bridge created for
 * this channel. Used as the safety check before allowing a channel delete.
 *
 * Path: `external_conversations` (by channelId) → `message_channel_links` (by
 * externalConversationId, direction='inbound'). Both tables are hub-owned, so
 * we stay on the right side of the cross-module isolation rule. No raw SQL.
 *
 * Round-2 F8 rename (2026-05-26): was `countUnreadInboundForChannel`, but the
 * function never counted "unread" — it always counted all inbound links. The
 * old name is preserved as a `@deprecated` alias for one minor version.
 */
export async function countInboundLinksForChannel(
  em: EntityManager,
  channelId: string,
  scope: ChannelScope,
): Promise<number> {
  const conversations = await findWithDecryption(
    em,
    ExternalConversation,
    {
      channelId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
    },
    { fields: ['id'] },
    scope,
  )
  if (conversations.length === 0) return 0
  const conversationIds = (conversations as Array<{ id: string }>).map((c) => c.id)
  const count = await em.count(
    MessageChannelLink,
    {
      externalConversationId: { $in: conversationIds },
      direction: 'inbound',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
    },
  )
  return typeof count === 'number' ? count : 0
}

/**
 * @deprecated Use `countInboundLinksForChannel`. Kept for one minor release so
 * external callers catch the rename window. Removed in the next minor.
 */
export const countUnreadInboundForChannel = countInboundLinksForChannel

// Re-export entity types so callers can keep their typing tight.
export type { CommunicationChannel, ExternalMessage, MessageChannelLink }
