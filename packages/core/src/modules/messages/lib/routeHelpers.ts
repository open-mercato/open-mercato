import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageRecipient } from '../data/entities'
import {
  CHANNEL_THREAD_FALLBACK_FEATURE,
  EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
  resolveActorFeatures,
  resolveMessageChannelThreadAccess,
} from './channelThreadAccess'

export function hasOrganizationAccess(
  scopeOrganizationId: string | null,
  messageOrganizationId: string | null | undefined,
): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

export type ChannelThreadCallerContext = {
  container: { resolve: <T = unknown>(name: string) => T }
  auth?: unknown
}

export type MessageScope = {
  tenantId: string
  organizationId: string | null
  userId: string
}

export async function resolveMessageContext(req: Request): Promise<{
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx']
  scope: MessageScope
}> {
  const { ctx } = await resolveRequestContext(req)
  return {
    ctx,
    scope: {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
    },
  }
}

type RbacService = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null }
  ) => Promise<boolean>
}

export async function parseRequestBodySafe(req: Request): Promise<unknown> {
  try {
    const text = await req.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Whether the caller may fall back to the channels hub's access rule on a
 * channel-linked thread (#5535).
 *
 * Resolved through RBAC, never through `ctx.auth.features`: the session JWT
 * carries no `features` claim, so reading it here would deny every caller —
 * a tenant admin included — and re-close the very journey #5535 opened. RBAC is
 * also what makes the check wildcard-aware. Fails closed, like the sibling
 * feature checks in this file.
 *
 * Takes only the container, so the reply and forward commands apply the same
 * gate as the read routes (#6355).
 */
export async function canUseChannelThreadFallback(
  ctx: { container: { resolve: (name: string) => unknown } },
  scope: MessageScope,
): Promise<boolean> {
  if (!scope.userId || !scope.tenantId) return false
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacService | undefined
    if (typeof rbac?.userHasAllFeatures !== 'function') return false
    return await rbac.userHasAllFeatures(scope.userId, [CHANNEL_THREAD_FALLBACK_FEATURE], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch {
    return false
  }
}

/**
 * Whether the caller may work the channel-linked thread `message` belongs to
 * through the channels hub's access rule, rather than as a participant (#5535).
 *
 * Shared by every read route that widens its participant test for channel
 * threads — the detail read, the attachments list and the forward preview — so
 * the three cannot drift apart (#6354). Only channel-sourced messages pay the
 * lookup; the fallback is feature-gated through {@link canUseChannelThreadFallback}
 * because the hub's rule grants every shared channel unconditionally. An
 * internal thread, a missing hub or a denied gate all read `false`, leaving the
 * participant rule in force.
 *
 * Callers still decide what the widening covers: channel access never opens a
 * message that is not explicitly public.
 */
export async function hasChannelThreadReadAccess(
  ctx: ChannelThreadCallerContext,
  scope: MessageScope,
  message: { id: string; threadId?: string | null; sourceEntityType?: string | null },
): Promise<boolean> {
  if (message.sourceEntityType !== EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) return false
  if (!(await canUseChannelThreadFallback(ctx, scope))) return false
  const channelThread = await resolveMessageChannelThreadAccess(
    ctx.container,
    { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
    { messageThreadId: message.threadId ?? message.id },
    { userId: scope.userId, features: resolveActorFeatures(ctx.auth) },
  )
  return channelThread?.canAccess === true
}

export type MessageReadAccess = {
  recipient: MessageRecipient | null
  isSender: boolean
  hasChannelThreadAccess: boolean
  canRead: boolean
}

/**
 * The read rule of `GET /api/messages/[id]`, for a message already loaded in the
 * caller's scope: the sender, a recipient whose row is not deleted, or — for an
 * explicitly public message only — a caller the channels hub lets work the
 * channel thread. Channel access never opens an internal note.
 *
 * Shared by the detail read and by every write that names another message as its
 * parent, so "may reference" can never be wider than "may read".
 */
export async function resolveMessageReadAccess(
  ctx: ChannelThreadCallerContext,
  scope: MessageScope,
  message: Pick<Message, 'id' | 'senderUserId' | 'visibility' | 'threadId' | 'sourceEntityType'>,
): Promise<MessageReadAccess> {
  const em = ctx.container.resolve('em') as EntityManager
  const recipient = await em.findOne(MessageRecipient, {
    messageId: message.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })
  const isSender = message.senderUserId === scope.userId
  const hasChannelThreadAccess = await hasChannelThreadReadAccess(ctx, scope, message)
  const isParticipant = isSender || Boolean(recipient)
  return {
    recipient,
    isSender,
    hasChannelThreadAccess,
    canRead: isParticipant || (hasChannelThreadAccess && message.visibility === 'public'),
  }
}

export type ReplyParentResolution =
  | { status: 'readable'; message: Message }
  | { status: 'not_found' }
  | { status: 'forbidden' }

/**
 * Resolve a caller-supplied parent message before a write threads onto it.
 *
 * The parent is looked up in exactly the scope the new message is written to —
 * tenant, organization (null only matches null) and not deleted — so a parent
 * that is unknown, deleted, or in another organization or tenant all answer
 * `not_found`. A parent in scope that the caller may not read answers
 * `forbidden`, the same distinction the detail read already makes.
 */
export async function resolveReplyParentMessage(
  ctx: ChannelThreadCallerContext,
  scope: MessageScope,
  parentMessageId: string,
): Promise<ReplyParentResolution> {
  const em = ctx.container.resolve('em') as EntityManager
  const parent = await findOneWithDecryption(
    em,
    Message,
    {
      id: parentMessageId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!parent) return { status: 'not_found' }
  const access = await resolveMessageReadAccess(ctx, scope, parent)
  return access.canRead ? { status: 'readable', message: parent } : { status: 'forbidden' }
}

/**
 * Whether the caller may post a message meant to leave the platform onto
 * `messageThreadId` (#5645 review, #6432).
 *
 * An internal thread, a thread outside the caller's scope and an absent hub all
 * resolve to `null` and allow, keeping the pre-existing rule. A channel thread
 * needs both the hub's access rule and `messages.view`, because the hub grants
 * every shared channel regardless of features. Shared by the compose route and
 * the draft send transition so a draft cannot be used to skip the gate.
 */
export async function canPostToChannelThread(
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx'],
  scope: MessageScope,
  messageThreadId: string,
): Promise<boolean> {
  const channelThread = await resolveMessageChannelThreadAccess(
    ctx.container,
    { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
    { messageThreadId },
    { userId: scope.userId, features: resolveActorFeatures(ctx.auth) },
  )
  if (!channelThread) return true
  return channelThread.canAccess && (await canUseChannelThreadFallback(ctx, scope))
}

export async function canUseMessageEmailFeature(
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx'],
  scope: MessageScope,
): Promise<boolean> {
  if (!scope.userId || !scope.tenantId) return false

  const rbac = ctx.container.resolve('rbacService') as RbacService
  return rbac.userHasAllFeatures(scope.userId, ['messages.email'], {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}
