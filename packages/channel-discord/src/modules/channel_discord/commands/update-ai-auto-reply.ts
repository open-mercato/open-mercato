import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { channelOrgScopeWhereFromFilter } from '@open-mercato/core/modules/communication_channels/lib/access-control'
import { discordChannelStateSchema } from '../lib/credentials'

/**
 * Resource kind the channel's optimistic-lock check is scoped under. It matches
 * the `resourceKind` the route's mutation guard uses, so an operator's stale tab
 * fails the same way here as it would on any other channel write.
 */
export const CHANNEL_DISCORD_CHANNEL_RESOURCE_KIND = 'communication_channels.channel'

export const CHANNEL_DISCORD_UPDATE_AI_AUTO_REPLY_COMMAND_ID =
  'channel_discord.channel.update_ai_auto_reply'

export const discordAiAutoReplySettingsSchema = z
  .object({
    aiAutoReplyEnabled: z.boolean(),
    aiAgentId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => !value.aiAutoReplyEnabled || Boolean(value.aiAgentId), {
    // Arming auto-reply without naming an agent is the state that made the
    // original subscriber dormant; the schema refuses to reproduce it.
    path: ['aiAgentId'],
    message: 'channel_discord.aiAutoReply.errors.agentRequired',
  })

export type DiscordAiAutoReplySettings = z.infer<typeof discordAiAutoReplySettingsSchema>

const updateAiAutoReplySchema = z.object({
  channelId: z.string().uuid(),
  settings: discordAiAutoReplySettingsSchema,
  scope: z.object({
    tenantId: z.string().uuid(),
    /** Organization the decryption scope is anchored to. */
    organizationId: z.string().uuid().nullable(),
    /**
     * Organizations the caller may see, as resolved by the route. A Discord bot
     * channel is usually tenant-scoped (`organization_id IS NULL`), so filtering
     * on a single organization would hide the very channels this command
     * configures — the hub's `channelOrgScopeWhereFromFilter` encodes the right
     * rule and is reused here.
     */
    organizationIds: z.array(z.string().uuid()).nullable().optional(),
  }),
  expectedUpdatedAt: z.string().optional(),
})

export type UpdateAiAutoReplyInput = z.infer<typeof updateAiAutoReplySchema>

export type UpdateAiAutoReplyResult =
  | {
      status: 'updated'
      channelId: string
      aiAutoReplyEnabled: boolean
      aiAgentId: string | null
      updatedAt: string | null
    }
  | { status: 'not_found' }

/**
 * Persist a Discord channel's AI auto-reply settings (issue #4778).
 *
 * The write goes through the command bus rather than an entity write in the
 * route so it inherits the platform's audit trail, and so the two keys the
 * subscriber reads have exactly one writer.
 *
 * Two things it is careful about:
 *
 * - **It merges.** `channelState` is shared with the gateway worker, which writes
 *   resume state (`sessionId`, `sequence`, `resumeGatewayUrl`, `botUserId`) from
 *   a socket callback. Replacing the blob would drop a live session's cursor and
 *   force a re-IDENTIFY, so only the two AI keys are touched — the mirror image
 *   of what `lib/channel-state-store.ts` does from the other side.
 * - **It version-checks.** The settings form sends the channel's `updatedAt`, so
 *   a save from a tab opened before someone else changed the channel fails with
 *   the standard 409 conflict body instead of silently winning.
 */
const updateAiAutoReplyCommand: CommandHandler<UpdateAiAutoReplyInput, UpdateAiAutoReplyResult> = {
  id: CHANNEL_DISCORD_UPDATE_AI_AUTO_REPLY_COMMAND_ID,
  // Not undoable on purpose: replaying a stale snapshot could re-arm auto-reply
  // on a channel an operator deliberately disarmed — for example after the bot
  // answered something it should not have. Reverting is a deliberate act through
  // the same form, which leaves its own audit entry.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = updateAiAutoReplySchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = { tenantId: input.scope.tenantId, organizationId: input.scope.organizationId }

    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: input.channelId,
        tenantId: input.scope.tenantId,
        providerKey: 'discord',
        ...channelOrgScopeWhereFromFilter({ organizationIds: input.scope.organizationIds ?? undefined }),
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    // Existence masking, consistent with the hub's channel-scoped routes: a
    // channel in another tenant and a channel that never existed answer alike.
    if (!channel) return { status: 'not_found' }

    // The DI-aware seam, not the bare synchronous helper: it runs the OSS
    // `updated_at` floor first and then awaits the optional enterprise
    // `record_locks` guard, so a channel someone else holds a lock on is
    // protected on an enterprise build too.
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: CHANNEL_DISCORD_CHANNEL_RESOURCE_KIND,
      resourceId: channel.id,
      current: channel.updatedAt,
      expected: input.expectedUpdatedAt ?? null,
      request: ctx.request ?? null,
    })

    const current = discordChannelStateSchema.parse(channel.channelState ?? {})
    const aiAgentId = input.settings.aiAutoReplyEnabled ? input.settings.aiAgentId : undefined

    await withAtomicFlush(
      em,
      [
        () => {
          channel.channelState = {
            ...current,
            aiAutoReplyEnabled: input.settings.aiAutoReplyEnabled,
            // Clearing the agent when auto-reply is switched off keeps the stored
            // state honest: a disabled channel does not keep pointing at an agent.
            aiAgentId,
          }
        },
      ],
      { transaction: true, label: 'channel_discord.channel.update_ai_auto_reply' },
    )

    return {
      status: 'updated',
      channelId: channel.id,
      aiAutoReplyEnabled: input.settings.aiAutoReplyEnabled,
      aiAgentId: aiAgentId ?? null,
      updatedAt: channel.updatedAt ? channel.updatedAt.toISOString() : null,
    }
  },
}

registerCommand(updateAiAutoReplyCommand as CommandHandler<unknown, unknown>)

export default updateAiAutoReplyCommand
