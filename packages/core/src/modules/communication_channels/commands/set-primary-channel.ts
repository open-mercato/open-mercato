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
  // Intentionally NOT undoable. Restoring a prior primary is order-sensitive
  // against the partial unique index `communication_channels_one_primary_per_user_uq`
  // (it would need the same clear-then-set, cross-org, two-phase dance as
  // `execute`), and a stale snapshot could re-primary a channel the user has
  // since disconnected. Sibling lifecycle commands (disconnect/delete) likewise
  // do not re-claim primary on undo. Declared explicitly so the omission reads
  // as a decision, not an oversight.
  isUndoable: false,
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
      // Existence masking: a non-existent channel is indistinguishable from one
      // owned by another user — both surface as 404 (not_owner) at the route,
      // consistent with the other channel-scoped routes (import-history, etc.).
      return { status: 'not_owner', reason: 'channel not found' }
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
    // `withAtomicFlush` issues ONE flush at the END of all phases (it does NOT
    // flush between them — see packages/shared/src/lib/commands/flush.ts), so a
    // managed-entity two-phase still lands the SET-false and SET-true updates in
    // that single unordered flush and races (23505). Phase 1 therefore flushes
    // the clear EXPLICITLY so Postgres observes `is_primary=false` before Phase
    // 2's SET-true UPDATE runs; the transaction wraps both for all-or-nothing.
    const previousPrimaries = await findWithDecryption(
      em,
      CommunicationChannel,
      {
        // The one-primary-per-user partial unique index keys on `user_id` only,
        // so it spans ALL organizations for a user. The prior primary must be
        // cleared regardless of which org it lives in — otherwise a multi-org
        // user setting a new primary in org B would collide (23505) with their
        // existing primary in org A. `CommunicationChannel` has no encrypted
        // fields, so the cross-org read needs no per-org decryption scope.
        tenantId: input.scope.tenantId,
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
        async () => {
          for (const prev of previousPrimaries as CommunicationChannel[]) {
            previousPrimaryChannelId = prev.id
            prev.isPrimary = false
          }
          // Flush the clear before Phase 2 sets the new primary, so Postgres
          // never sees two `is_primary` rows for this user at once (see above).
          await em.flush()
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
