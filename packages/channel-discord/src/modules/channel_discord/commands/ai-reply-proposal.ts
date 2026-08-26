import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandBus, CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message } from '@open-mercato/core/modules/messages/data/entities'
import {
  CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_COMMAND_ID,
  CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_COMMAND_ID,
} from '../lib/ai-proposal-contract'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../message-types'

const logger = createLogger('channel_discord').child({ component: 'ai-reply-proposal' })

/**
 * Commands behind the `complex`-tier approval card (issue #4778).
 *
 * `messages.actions.execute` dispatches these after it has atomically claimed
 * the terminal action, so both handlers can assume they run at most once per
 * proposal. It passes `messageId` / `actionId` and the acting operator in
 * `ctx.auth` — everything else these commands need is read from the stored
 * proposal, never from the request body, so a caller cannot redirect the send.
 */
const proposalActionInputSchema = z
  .object({
    messageId: z.string().uuid(),
    actionId: z.string().min(1),
  })
  .passthrough()

type ProposalActionInput = z.infer<typeof proposalActionInputSchema>

export type ApproveProposalResult = { ok: true; sentMessageId: string; threadId: string | null }
export type DismissProposalResult = { ok: true; dismissed: true }

type ResolvedScope = { tenantId: string; organizationId: string | null; userId: string }

function requireScope(auth: { sub?: string; tenantId?: string | null; orgId?: string | null } | null): ResolvedScope {
  const userId = auth?.sub
  const tenantId = auth?.tenantId
  if (!userId || !tenantId) {
    throw new Error('[internal] channel_discord AI proposal action requires an authenticated actor')
  }
  return { tenantId, organizationId: auth?.orgId ?? null, userId }
}

async function loadProposal(
  em: EntityManager,
  messageId: string,
  scope: ResolvedScope,
): Promise<Message> {
  const proposal = await findOneWithDecryption(
    em,
    Message,
    { id: messageId, tenantId: scope.tenantId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!proposal) throw new Error('[internal] AI reply proposal not found')
  if (proposal.type !== CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE) {
    // The action is only ever rendered on our own message type; a mismatch means
    // the id was swapped, so refuse rather than sending an unrelated message body
    // into a Discord server.
    throw new Error('[internal] Message is not a Discord AI reply proposal')
  }
  return proposal
}

const approveProposalCommand: CommandHandler<ProposalActionInput, ApproveProposalResult> = {
  id: CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_COMMAND_ID,
  // A message posted into a Discord server cannot be recalled by undoing a row
  // here, so the command declines to pretend otherwise.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = proposalActionInputSchema.parse(rawInput)
    const scope = requireScope(ctx.auth)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const proposal = await loadProposal(em, input.messageId, scope)
    const inboundMessageId = proposal.sourceEntityId
    if (!inboundMessageId) {
      throw new Error('[internal] AI reply proposal has no source message to reply to')
    }

    const inbound = await findOneWithDecryption(
      em,
      Message,
      { id: inboundMessageId, tenantId: scope.tenantId, deletedAt: null },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (!inbound) {
      throw new Error('[internal] The message this proposal answers no longer exists')
    }

    const body = (proposal.body ?? '').trim()
    if (!body) {
      throw new Error('[internal] AI reply proposal has an empty body')
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    // Same generic outbound path the easy tier uses: compose a public reply in
    // the thread and let the hub's outbound bridge deliver it. Attribution is the
    // approving operator, not the bot — a human decided to send this.
    const composeResult = await commandBus.execute<
      Record<string, unknown>,
      { id: string; threadId: string | null }
    >('messages.messages.compose', {
      input: {
        type: inbound.type,
        visibility: 'public' as const,
        subject: (inbound.subject ?? 'Discord reply').toString().slice(0, 200) || 'Discord reply',
        body,
        bodyFormat: 'markdown' as const,
        priority: 'normal' as const,
        sendViaEmail: false,
        parentMessageId: inbound.threadId ?? inbound.id,
        isDraft: false,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
      ctx: {
        container: ctx.container,
        auth: ctx.auth ?? null,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: scope.organizationId ? [scope.organizationId] : null,
      },
    })

    const sent = composeResult.result
    logger.info('AI reply proposal approved and sent', {
      proposalId: proposal.id,
      sentMessageId: sent.id,
    })
    return { ok: true, sentMessageId: sent.id, threadId: sent.threadId ?? null }
  },
}

const dismissProposalCommand: CommandHandler<ProposalActionInput, DismissProposalResult> = {
  id: CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = proposalActionInputSchema.parse(rawInput)
    const scope = requireScope(ctx.auth)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Nothing to write: `messages.actions.execute` has already recorded the
    // terminal action, which is what "dismissed" means. The load is the guard —
    // it keeps the dismiss action from acknowledging a message that is not ours.
    const proposal = await loadProposal(em, input.messageId, scope)
    logger.info('AI reply proposal dismissed', { proposalId: proposal.id })
    return { ok: true, dismissed: true }
  },
}

registerCommand(approveProposalCommand as CommandHandler<unknown, unknown>)
registerCommand(dismissProposalCommand as CommandHandler<unknown, unknown>)

export { approveProposalCommand, dismissProposalCommand }
