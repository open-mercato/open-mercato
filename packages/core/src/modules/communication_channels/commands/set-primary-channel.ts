import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { emitCommunicationChannelsEvent } from '../events'

const setPrimaryChannelSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type SetPrimaryChannelInput = z.infer<typeof setPrimaryChannelSchema>

export type SetPrimaryChannelResult =
  | { status: 'set'; channelId: string; previousPrimaryChannelId: string | null }
  | { status: 'noop'; reason: string }
  | { status: 'not_owner'; reason: string }

export const COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID =
  'communication_channels.channel.set_primary'

/**
 * Mark a per-user channel as primary. Clears the primary flag on every other
 * channel owned by the same user. Enforced as one-primary-per-user by the
 * partial unique index `communication_channels_one_primary_per_user_uq`.
 *
 * Ownership-checked: refuses to set a primary on someone else's channel.
 */
const setPrimaryChannelCommand: CommandHandler<
  SetPrimaryChannelInput,
  SetPrimaryChannelResult
> = {
  id: COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = setPrimaryChannelSchema.parse(rawInput) as SetPrimaryChannelInput
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
      return { status: 'noop', reason: 'channel not found' }
    }
    if (channel.userId !== input.userId) {
      return { status: 'not_owner', reason: 'channel is not owned by the current user' }
    }
    if (channel.isPrimary) {
      return { status: 'noop', reason: 'channel is already primary' }
    }

    // The partial unique index `communication_channels_one_primary_per_user_uq`
    // forbids two rows where `is_primary AND user_id = X`. PostgreSQL does NOT
    // defer partial unique checks — every UPDATE statement is checked against
    // the live partial index. So a SINGLE `em.flush()` containing both
    // `is_primary=false` and `is_primary=true` updates is unsafe: MikroORM
    // does not guarantee SET-false statements execute before SET-true.
    //
    // Fix (review R2-H1 / F2, 2026-05-26): two phases inside one transaction.
    // `withAtomicFlush` runs each phase and flushes between them (the platform
    // helper for exactly this multi-phase mutation — see packages/core/AGENTS.md
    // "Entity Update Safety"). Phase 1 clears + flushes so Postgres observes
    // `is_primary=false` before Phase 2's UPDATE runs; the transaction wraps both
    // for all-or-nothing semantics.
    const previousPrimaries = await findWithDecryption(
      em,
      CommunicationChannel,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        userId: input.userId,
        isPrimary: true,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    let previousPrimaryChannelId: string | null = null
    await withAtomicFlush(
      em,
      [
        () => {
          for (const prev of previousPrimaries as CommunicationChannel[]) {
            previousPrimaryChannelId = prev.id
            prev.isPrimary = false
          }
        },
        () => {
          channel.isPrimary = true
        },
      ],
      { transaction: true },
    )

    await emitCommunicationChannelsEvent(
      'communication_channels.channel.primary_changed',
      {
        channelId: channel.id,
        userId: input.userId,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        previousPrimaryChannelId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      { persistent: true },
    )

    return {
      status: 'set',
      channelId: channel.id,
      previousPrimaryChannelId,
    }
  },
}

registerCommand(setPrimaryChannelCommand)

export default setPrimaryChannelCommand
