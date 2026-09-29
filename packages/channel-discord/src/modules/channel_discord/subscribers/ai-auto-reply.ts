import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { Message } from '@open-mercato/core/modules/messages/data/entities'
import { resolveCommunicationChannelsSystemUserId } from '@open-mercato/core/modules/communication_channels/lib/system-user'
import {
  CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
  discordAutoReplyOutputSchema,
  type DiscordAutoReplyOutput,
} from '../ai-agents'
import {
  classifyDiscordMessage,
  hasStoredAutoReplyFailure,
  isAiAssistantAvailable,
  isAiAutoReplyEnabled,
  resolveAiAgentId,
  type SubscriberResolver,
} from '../lib/ai-reply'
import { DISCORD_CHANNEL_TYPE } from '../lib/channel-identity'
import { fileDiscordReplyProposal } from '../lib/ai-proposal'
import { resolveDiscordAiPrincipal, type DiscordAiPrincipal } from '../lib/ai-service-principal'
import { recordDiscordAutoReplyOutcome } from '../lib/channel-state-store'
import { describeAgentFailure } from '../lib/failure-reason'

const logger = createLogger('channel_discord').child({ component: 'ai-auto-reply' })

/**
 * AI auto-reply subscriber (SPEC 2026-06-19 § AI bot wiring, issue #4778).
 *
 * Listens to `communication_channels.message.received`, filters to Discord, and —
 * only when the channel opted in (default OFF) AND the optional `ai_assistant`
 * peer is present — drafts a reply through the programmatic agent runtime. An
 * "easy" message the model is confident about is answered directly through the
 * generic hub outbound path (compose → outbound-bridge → `deliver_outbound` →
 * Discord REST). Anything else becomes a proposal a human approves. Nothing
 * Discord-specific leaks into the send path; any module could do the same.
 *
 * How the guarantees actually hold, rather than by convention:
 *
 *   - `ai_assistant` is an OPTIONAL peer resolved softly; absent → no-op, and the
 *     channel keeps working as a plain inbox.
 *   - The agent runs under a real, tenant-scoped identity with real `features`
 *     (`lib/ai-service-principal.ts`), never `features: []` and never as a
 *     super-admin. `runAiAgentObject` enforces the agent's `requiredFeatures`,
 *     `executionMode` and `mutationPolicy` against it; this subscriber cannot
 *     widen them.
 *   - The agent is object-mode, so the runtime never exposes a tool to the model
 *     — no privileged action is reachable from an inbound Discord message at all,
 *     let alone auto-executable.
 *   - Auto-send needs THREE independent yeses: the conservative regex tiering
 *     says `easy`, the model says it does not need a human, and the model's own
 *     confidence clears {@link AUTO_SEND_MIN_CONFIDENCE}. Any single no routes the
 *     draft to the approval surface instead.
 *   - Every failure degrades to a no-op. A broken model, a denied policy check, a
 *     malformed object — none of them can turn into a send.
 */
export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'channel_discord:ai-auto-reply',
}

/**
 * Below this, the model's own draft is proposed rather than sent. The number is
 * deliberately high: the cost of a wrong auto-answer in a public Discord server
 * is much higher than the cost of a human glancing at a proposal.
 */
export const AUTO_SEND_MIN_CONFIDENCE = 0.6

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
    sessionId?: string
  }) => Promise<{ mode: string; object: unknown }>
}

export default async function handler(payload: MessageReceivedPayload, ctx: Ctx): Promise<void> {
  // (1) Filter — Discord inbound only.
  if (payload?.providerKey !== 'discord') return
  if (payload?.direction && payload.direction !== 'inbound') return
  if (!payload?.messageId || !payload?.channelId || !payload?.tenantId) return

  const em = resolveFromCtx<EntityManager>(ctx, 'em').fork()
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId ?? null }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id: payload.channelId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!channel) return

  // (2) Per-channel opt-in (default OFF), written by the settings surface at
  // `/backend/channel_discord/channels/<id>/ai-auto-reply`.
  if (!isAiAutoReplyEnabled(channel.channelState)) return

  // (3) Soft-resolve the optional AI peer — no-op when absent (module-decoupling).
  if (!isAiAssistantAvailable(ctx)) {
    logger.debug('ai_assistant peer unavailable — skipping auto-reply (channel still works as inbox)')
    return
  }

  // The settings form always stores an explicit agent id; the fallback covers a
  // channel armed by an older preset or by hand.
  const agentId = resolveAiAgentId(channel.channelState) ?? CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID

  const message = await findOneWithDecryption(
    em,
    Message,
    { id: payload.messageId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!message) return
  const body = (message.body ?? '').toString()

  // (4) Classify — easy vs complex. Conservative by construction: it can only
  // ever escalate a message away from auto-send.
  const classification = classifyDiscordMessage(body)

  try {
    await draftAndRoute({
      ctx,
      em,
      message,
      channelId: payload.channelId,
      conversationId: payload.conversationId ?? null,
      agentId,
      body,
      scope,
      tier: classification.tier,
      classificationReason: classification.reason,
    })
    // Clearing costs a read-modify-write, so only pay it on a channel that is
    // actually carrying a stale failure. The row was already loaded above.
    if (hasStoredAutoReplyFailure(channel.channelState)) {
      await recordAutoReplyOutcome({ em, channelId: payload.channelId, scope, failure: null })
    }
  } catch (err) {
    // The no-op is the correct behaviour — a broken model must never become a
    // send. Staying silent about it is not: the operator's surface would keep
    // reading "Auto-reply on" for a channel that answers nothing. Park the reason
    // on the channel so the settings page and the integration panel can show it.
    logger.warn('discord AI auto-reply failed — degrading to no-op', { channelId: payload.channelId, err })
    await recordAutoReplyOutcome({
      em,
      channelId: payload.channelId,
      scope,
      failure: describeAgentFailure(agentId, err),
    })
  }
}

/**
 * Persisting the outcome must never be able to turn a degraded no-op into a
 * thrown handler — the marker is diagnostics, not the job.
 */
async function recordAutoReplyOutcome(params: {
  em: EntityManager
  channelId: string
  scope: { tenantId: string; organizationId: string | null }
  failure: string | null
}): Promise<void> {
  try {
    await recordDiscordAutoReplyOutcome(params)
  } catch (err) {
    logger.warn('failed to persist the discord auto-reply outcome marker', {
      channelId: params.channelId,
      err,
    })
  }
}

async function draftAndRoute(args: {
  ctx: Ctx
  em: EntityManager
  message: Message
  channelId: string
  conversationId: string | null
  agentId: string
  body: string
  scope: { tenantId: string; organizationId: string | null }
  tier: 'easy' | 'complex'
  classificationReason: string
}): Promise<void> {
  const { ctx, em, message, channelId, conversationId, agentId, body, scope, tier, classificationReason } = args

  const principal = await resolveDiscordAiPrincipal({ em, resolver: { resolve: (name) => resolveFromCtx(ctx, name) }, scope })

  const draft = await runAutoReplyAgent({ ctx, agentId, body, principal, sessionId: message.threadId ?? message.id })
  if (!draft) return

  const reply = draft.reply.trim()
  if (!reply) return

  const autoSend =
    tier === 'easy' && !draft.requiresHuman && draft.confidence >= AUTO_SEND_MIN_CONFIDENCE
  const commandBus = resolveFromCtx<CommandBus>(ctx, 'commandBus')
  const containerCtx = {
    container: { resolve: (name: string) => resolveFromCtx(ctx, name) },
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: scope.organizationId ? [scope.organizationId] : null,
  }
  const botUserId = await resolveCommunicationChannelsSystemUserId(em, scope.tenantId, null)

  if (!autoSend) {
    const reason = draft.requiresHuman
      ? 'model-requested-review'
      : draft.confidence < AUTO_SEND_MIN_CONFIDENCE
        ? `low-confidence:${draft.confidence.toFixed(2)}`
        : classificationReason
    await fileDiscordReplyProposal({
      em,
      commandBus,
      containerCtx,
      scope,
      channelId,
      inboundMessage: message,
      externalConversationId: conversationId,
      botUserId,
      proposedReply: reply,
      summary: draft.summary,
      reason,
    })
    return
  }

  // Easy + confident → answer directly. The hub's outbound-bridge subscriber
  // picks up `messages.message.sent`, resolves the Discord channel via the
  // ChannelThreadMapping, and delivers through `deliver_outbound` → `sendMessage`.
  // No direct Discord call here — keep the send path generic and audited.
  await commandBus.execute('messages.messages.compose', {
    input: {
      type: 'channel.discord',
      visibility: 'public' as const,
      // Without this the hub demands an `externalEmail` and every automatic
      // reply dies in validation (#5601). `channelTypeRequiresExternalEmail`
      // fails closed on an absent type, and a Discord sender is a snowflake with
      // no address, so the requirement can never be met — the subscriber has to
      // say which channel it is composing for. `'discord'` is already recognized
      // by `NON_EMAIL_SENDER_CHANNEL_TYPES` (#4975); nothing else is waived.
      sourceChannelType: DISCORD_CHANNEL_TYPE,
      subject: (message.subject ?? 'Discord reply').toString().slice(0, 200) || 'Discord reply',
      body: reply,
      bodyFormat: 'markdown' as const,
      priority: 'normal' as const,
      sendViaEmail: false,
      parentMessageId: message.threadId ?? message.id,
      isDraft: false,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: botUserId,
    },
    ctx: containerCtx as never,
  })
}

async function runAutoReplyAgent(args: {
  ctx: Ctx
  agentId: string
  body: string
  principal: DiscordAiPrincipal
  sessionId: string
}): Promise<DiscordAutoReplyOutput | null> {
  const { agentId, body, principal, sessionId } = args

  // Dynamic import keeps `ai_assistant` a truly optional peer — when the package
  // is not installed the import throws and we no-op (already gated by the DI
  // presence check in the handler, so this only runs when the peer is active).
  const mod = (await import('@open-mercato/ai-assistant')) as unknown as AiAssistantModule
  if (typeof mod.runAiAgentObject !== 'function') return null

  // The runtime only touches `container.resolve(...)`; a proxy over the
  // subscriber resolver satisfies that without depending on a concrete DI name
  // (mirrors the inbound-processor's `containerProxy` pattern).
  const container = { resolve: (name: string) => resolveFromCtx(args.ctx, name) }

  // No `output` override: the agent declares its own schema, so the schema the
  // policy layer validated the agent against is the schema the model is held to.
  const result = await mod.runAiAgentObject({
    agentId,
    input: body,
    authContext: {
      tenantId: principal.tenantId,
      organizationId: principal.organizationId,
      userId: principal.userId,
      features: principal.features,
      isSuperAdmin: principal.isSuperAdmin,
    },
    container,
    // Preserve multi-turn context per conversation thread.
    sessionId,
  })

  const parsed = discordAutoReplyOutputSchema.safeParse((result as { object?: unknown }).object)
  if (!parsed.success) {
    logger.warn('auto-reply agent returned an object that does not match the declared schema', {
      agentId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    })
    return null
  }
  return parsed.data
}
