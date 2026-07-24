import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { Message } from '@open-mercato/core/modules/messages/data/entities'
import { resolveCommunicationChannelsSystemUserId } from '@open-mercato/core/modules/communication_channels/lib/system-user'
import {
  classifyDiscordMessage,
  isAiAssistantAvailable,
  isAiAutoReplyEnabled,
  resolveAiAgentId,
  type SubscriberResolver,
} from '../lib/ai-reply'

const logger = createLogger('channel_discord').child({ component: 'ai-auto-reply' })

/**
 * AI auto-reply subscriber (SPEC 2026-06-19 § AI bot wiring).
 *
 * Listens to `communication_channels.message.received`, filters to Discord, and
 * — only when the channel opted in (default OFF) AND the optional `ai_assistant`
 * peer is present — drafts a reply via the programmatic agent runtime and sends
 * it back through the generic hub outbound path (compose → outbound-bridge →
 * `deliver_outbound` → Discord REST). Nothing Discord-specific leaks into the
 * send path; any module could do the same.
 *
 * Safety:
 *   - `ai_assistant` is an OPTIONAL peer resolved softly; absent → no-op.
 *   - Easy messages auto-reply (text only). Complex / low-confidence messages
 *     are NOT auto-sent — they surface for human approval (propose-only).
 *   - The agent runs with the channel's tenant scope; `runAiAgentObject`
 *     enforces the agent's own `requiredFeatures` / `mutationPolicy` — this
 *     subscriber cannot widen them. Privileged writes still route through the AI
 *     mutation-approval gate.
 */
export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'channel_discord:ai-auto-reply',
}

type MessageReceivedPayload = {
  messageId?: string
  channelId?: string
  conversationId?: string
  providerKey?: string
  channelType?: string
  direction?: string
  tenantId?: string
  organizationId?: string | null
}

type Ctx = SubscriberResolver

function resolveFromCtx<T = unknown>(ctx: Ctx, name: string): T {
  if (typeof ctx?.resolve === 'function') return ctx.resolve<T>(name)
  if (ctx?.container && typeof ctx.container.resolve === 'function') return ctx.container.resolve<T>(name)
  throw new Error(`[internal] channel_discord ai-auto-reply: no resolver for '${name}'`)
}

/** Minimal shape of the optional `@open-mercato/ai-assistant` peer we call. */
interface AiAssistantModule {
  runAiAgentObject: (input: {
    agentId: string
    input: string
    authContext: Record<string, unknown>
    container: unknown
    output: { schemaName: string; schema: unknown; mode: 'generate' }
    sessionId?: string
  }) => Promise<{ mode: string; object: unknown }>
}

export default async function handler(payload: MessageReceivedPayload, ctx: Ctx): Promise<void> {
  // (1) Filter — Discord inbound only.
  if (payload?.providerKey !== 'discord') return
  if (payload?.direction && payload.direction !== 'inbound') return
  if (!payload?.messageId || !payload?.channelId || !payload?.tenantId) return

  const em = resolveFromCtx<EntityManager>(ctx, 'em').fork()
  const dscope = { tenantId: payload.tenantId, organizationId: payload.organizationId ?? null }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id: payload.channelId, tenantId: payload.tenantId, organizationId: payload.organizationId ?? null, deletedAt: null },
    undefined,
    dscope,
  )
  if (!channel) return

  // (2) Per-channel opt-in (default OFF).
  if (!isAiAutoReplyEnabled(channel.channelState)) return

  // (3) Soft-resolve the optional AI peer — no-op when absent (module-decoupling).
  if (!isAiAssistantAvailable(ctx)) {
    logger.debug('ai_assistant peer unavailable — skipping auto-reply (channel still works as inbox)')
    return
  }

  const agentId = resolveAiAgentId(channel.channelState)
  if (!agentId) {
    logger.debug('no aiAgentId configured on channel — skipping auto-reply')
    return
  }

  const message = await findOneWithDecryption(
    em,
    Message,
    { id: payload.messageId, tenantId: payload.tenantId, organizationId: payload.organizationId ?? null, deletedAt: null },
    undefined,
    dscope,
  )
  if (!message) return
  const body = (message.body ?? '').toString()

  // (4) Classify — easy vs complex.
  const classification = classifyDiscordMessage(body)
  if (classification.tier === 'complex') {
    // Propose-only: never auto-send anything risky. A follow-up surfaces the
    // proposed reply for human approval in the inbox UI.
    logger.info('discord message classified complex — propose-only, no auto-send', {
      channelId: payload.channelId,
      reason: classification.reason,
    })
    return
  }

  // (5) Easy → draft + send. Everything is guarded so any failure degrades to a
  // no-op (the channel keeps working as a plain inbox).
  try {
    await draftAndSendEasyReply({ ctx, em, channel, message, agentId, body, scope: dscope })
  } catch (err) {
    logger.warn('discord AI auto-reply failed — degrading to no-op', { channelId: payload.channelId, err })
  }
}

async function draftAndSendEasyReply(args: {
  ctx: Ctx
  em: EntityManager
  channel: CommunicationChannel
  message: Message
  agentId: string
  body: string
  scope: { tenantId: string; organizationId: string | null }
}): Promise<void> {
  const { ctx, em, channel, message, agentId, body, scope } = args

  // Dynamic import keeps `ai_assistant` a truly optional peer — when the package
  // is not installed the import throws and we no-op (already gated by the DI
  // presence check above, so this only runs when the peer is active).
  const mod = (await import('@open-mercato/ai-assistant')) as unknown as AiAssistantModule
  if (typeof mod.runAiAgentObject !== 'function') return

  // The runtime only touches `container.resolve(...)`; a proxy over the
  // subscriber resolver satisfies that without depending on a concrete DI name
  // (mirrors the inbound-processor's `containerProxy` pattern).
  const container = { resolve: (name: string) => resolveFromCtx(ctx, name) }
  const replySchema = z.object({ reply: z.string().min(1).max(2000) })

  const result = await mod.runAiAgentObject({
    agentId,
    input: body,
    authContext: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: null,
      features: [],
      isSuperAdmin: false,
    },
    container,
    output: { schemaName: 'discord_auto_reply', schema: replySchema, mode: 'generate' },
    // Preserve multi-turn context per conversation thread.
    sessionId: message.threadId ?? message.id,
  })

  const parsed = replySchema.safeParse((result as { object?: unknown }).object)
  if (!parsed.success || !parsed.data.reply.trim()) return

  // Compose an outbound reply in the same thread. The hub's outbound-bridge
  // subscriber picks up `messages.message.sent`, resolves the Discord channel via
  // the ChannelThreadMapping, and delivers through `deliver_outbound` →
  // `sendMessage`. No direct Discord call here — keep the send path generic +
  // audited.
  const commandBus = resolveFromCtx<CommandBus>(ctx, 'commandBus')
  const userId = await resolveCommunicationChannelsSystemUserId(em, scope.tenantId, null)
  const composeInput = {
    type: 'channel.discord',
    visibility: 'public' as const,
    subject: (message.subject ?? 'Discord reply').toString().slice(0, 200) || 'Discord reply',
    body: parsed.data.reply.trim(),
    bodyFormat: 'markdown' as const,
    priority: 'normal' as const,
    sendViaEmail: false,
    parentMessageId: message.threadId ?? message.id,
    isDraft: false,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId,
  }

  await commandBus.execute('messages.messages.compose', {
    input: composeInput,
    ctx: {
      container: { resolve: (name: string) => resolveFromCtx(ctx, name) } as never,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: scope.organizationId ? [scope.organizationId] : null,
    } as never,
  })
  void channel
}
