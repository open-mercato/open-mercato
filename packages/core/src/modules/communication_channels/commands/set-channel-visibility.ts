import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { emitCommunicationChannelsEvent } from '../events'

export const CHANNEL_VISIBILITY_VALUES = ['private', 'shared'] as const
export type ChannelVisibility = (typeof CHANNEL_VISIBILITY_VALUES)[number]

const setChannelVisibilitySchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  visibility: z.enum(CHANNEL_VISIBILITY_VALUES),
  expectedUpdatedAt: z.string().min(1).nullable().optional(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type SetChannelVisibilityInput = z.infer<typeof setChannelVisibilitySchema>

export type SetChannelVisibilityResult =
  | { status: 'set'; channelId: string; previousVisibility: ChannelVisibility }
  | { status: 'noop'; reason: string }
  | { status: 'not_owner'; reason: string }

export const COMMUNICATION_CHANNELS_SET_VISIBILITY_COMMAND_ID =
  'communication_channels.channel.set_visibility'

const RESOURCE_KIND = 'communication_channels.channel'

/**
 * Flip a PERSONAL channel between `private` and `shared` — the "this is a team
 * mailbox" toggle.
 *
 * Owner-only by construction: the command refuses any channel whose `userId` is
 * not the caller, so holding `communication_channels.share_own_channel` grants no
 * access to another user's mailbox and the inert
 * `communication_channels.admin` feature stays inert.
 *
 * Tenant-scoped channels (`userId IS NULL`) are rejected rather than flipped:
 * they are shared by definition, they are push infrastructure, and they have no
 * owner who could consent to the change.
 *
 * Read-time only: this writes `communication_channels.visibility` and nothing
 * else. `customer_interactions.visibility` is never rewritten, so flipping back
 * to private re-hides everything instantly and losslessly, and the query index
 * cannot drift.
 */
const setChannelVisibilityCommand: CommandHandler<
  SetChannelVisibilityInput,
  SetChannelVisibilityResult
> = {
  id: COMMUNICATION_CHANNELS_SET_VISIBILITY_COMMAND_ID,

  async execute(rawInput, ctx) {
    const input = setChannelVisibilitySchema.parse(rawInput) as SetChannelVisibilityInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

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
      dscope,
    )
    if (!channel) {
      // Existence masking: a missing channel and someone else's channel both
      // surface as 404 at the route, matching every sibling channel route.
      return { status: 'not_owner', reason: 'channel not found' }
    }
    if (channel.userId !== input.userId) {
      return { status: 'not_owner', reason: 'channel not owned by caller' }
    }

    const previousVisibility: ChannelVisibility =
      channel.visibility === 'shared' ? 'shared' : 'private'
    if (previousVisibility === input.visibility) {
      return { status: 'noop', reason: 'visibility already at requested value' }
    }

    // Optimistic locking (default ON per root AGENTS.md). An absent expectation
    // is strictly additive — the shared helper skips the assertion rather than
    // blocking clients that do not send the header.
    assertOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: channel.id,
      expected: input.expectedUpdatedAt ?? null,
      current: channel.updatedAt ?? null,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          channel.visibility = input.visibility
        },
      ],
      { transaction: true, label: COMMUNICATION_CHANNELS_SET_VISIBILITY_COMMAND_ID },
    )

    // Audit trail, best-effort: the flip is committed, so a failed emission must
    // not surface as a failed request.
    try {
      await emitCommunicationChannelsEvent('communication_channels.channel.visibility_changed', {
        channelId: channel.id,
        userId: input.userId,
        actorUserId: input.userId,
        previousVisibility,
        nextVisibility: input.visibility,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      })
    } catch {
      /* swallow — audit emission must not block a committed write */
    }

    return { status: 'set', channelId: channel.id, previousVisibility }
  },
}

registerCommand(setChannelVisibilityCommand)

export { setChannelVisibilityCommand }
