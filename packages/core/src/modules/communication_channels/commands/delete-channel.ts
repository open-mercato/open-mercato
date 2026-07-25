import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload as extractSharedUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { pushUnregister } from './push-unregister'
import { emitCommunicationChannelsEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'delete-channel' })

const deleteChannelSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type DeleteChannelInput = z.infer<typeof deleteChannelSchema>

export type DeleteChannelResult =
  | { status: 'deleted'; channelId: string; undo: DeleteChannelUndoSnapshot }
  | { status: 'noop'; reason: string }
  | { status: 'not_owner'; reason: string }

export interface DeleteChannelUndoSnapshot {
  channelId: string
  // Optional only for back-compat with any pre-existing log entries; new
  // snapshots always set it so the undo lookup stays tenant-scoped.
  tenantId?: string
}

export const COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID =
  'communication_channels.channel.delete'

/**
 * Soft-delete a per-user channel (sets `deleted_at`) — the channel row only.
 * Channel re-resolution (polling scheduler, inbound routing) and the
 * one-primary-per-user unique index already filter `deleted_at IS NULL`, so the
 * soft-delete stops new ingest into this channel. It does NOT cascade: existing
 * conversation / message / thread / reaction read-models carry `channelId` /
 * `conversationId` but are not channel-gated, so they remain readable via joins
 * until a future retention sweep. `is_primary` is cleared so a later undo cannot
 * resurrect a second primary for the user (the partial-unique index would
 * otherwise reject the restore).
 *
 * Provider-side push delivery is torn down best-effort BEFORE the soft-delete,
 * while `credentialsRef` is still present — mirrors `disconnect-channel`.
 *
 * Undoable: undo clears `deleted_at` to restore the row. It intentionally does
 * NOT re-claim primary status (would risk the one-primary-per-user constraint);
 * the owner re-selects a primary after a restore.
 */
const deleteChannelCommand: CommandHandler<DeleteChannelInput, DeleteChannelResult> = {
  id: COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID,
  // Explicitly undoable (the bus also infers this from `undo` below, but
  // declaring it keeps undoability from silently dropping under a refactor).
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = deleteChannelSchema.parse(rawInput) as DeleteChannelInput
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

    // Tear down provider-side push delivery before the soft-delete, while
    // credentials are still resolvable. Best-effort — failures are logged inside
    // pushUnregister and never re-raised.
    if (input.scope.organizationId) {
      try {
        await pushUnregister({
          container: ctx.container,
          scope: {
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId,
            userId: input.userId,
          },
          input: { channelId: channel.id },
        })
      } catch (err) {
        logger.warn('push unregister failed for channel', { channelId: channel.id, err })
      }
    }

    channel.deletedAt = new Date()
    channel.isPrimary = false
    await em.flush()

    // Emit AFTER flush so subscribers observe the committed soft-delete.
    // Lifecycle parity with `disconnect` (which emits `channel.disconnected`) so
    // workflows/audit can observe the full channel lifecycle. Persistent so the
    // delivery can retry on failure.
    await emitCommunicationChannelsEvent(
      'communication_channels.channel.deleted',
      {
        channelId: channel.id,
        userId: input.userId,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      { persistent: true },
    )

    return {
      status: 'deleted',
      channelId: channel.id,
      undo: { channelId: channel.id, tenantId: channel.tenantId },
    }
  },
  // Persist the undo snapshot into the action log. Without this, the command bus
  // mints an undo token (so the UI offers "Undo") but the snapshot returned from
  // execute() is never stored, and undo() (which clears deleted_at) would no-op.
  async buildLog({ input, result }) {
    if (result.status !== 'deleted') return null
    return {
      resourceKind: 'communication_channels.channel',
      resourceId: result.channelId,
      tenantId: result.undo.tenantId ?? input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
      payload: { undo: result.undo },
    }
  },
  async undo({ ctx, logEntry }) {
    const snapshot = extractSnapshotFromLog(logEntry)
    if (!snapshot || !snapshot.tenantId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // Re-find WITHOUT the `deletedAt: null` filter — the row we are restoring is
    // soft-deleted. Tenant-scoped to avoid cross-tenant resolution by bare id.
    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      { id: snapshot.channelId, tenantId: snapshot.tenantId },
      undefined,
      { tenantId: snapshot.tenantId, organizationId: null },
    )
    if (!channel) return
    channel.deletedAt = null
    await em.flush()
  },
}

/**
 * Defensive shape-validator for the delete snapshot — mirrors the helper in
 * `disconnect-channel.ts` so tests can construct snapshots directly.
 */
export function extractUndoPayload(value: unknown): DeleteChannelUndoSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { undo?: unknown; channelId?: unknown }).undo ?? value
  if (!candidate || typeof candidate !== 'object') return null
  const obj = candidate as Record<string, unknown>
  if (typeof obj.channelId !== 'string') return null
  return {
    channelId: obj.channelId,
    tenantId: typeof obj.tenantId === 'string' ? obj.tenantId : undefined,
  }
}

function extractSnapshotFromLog(logEntry: unknown): DeleteChannelUndoSnapshot | null {
  const undo = extractSharedUndoPayload<DeleteChannelUndoSnapshot>((logEntry ?? null) as never)
  if (undo) return extractUndoPayload(undo)
  return extractUndoPayload(logEntry)
}

registerCommand(deleteChannelCommand)

export default deleteChannelCommand
