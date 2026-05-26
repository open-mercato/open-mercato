import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandInterceptor,
  CommandInterceptorBeforeResult,
  CommandInterceptorUndoContext,
} from '@open-mercato/shared/lib/commands/command-interceptor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import {
  COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
  extractUndoPayload,
  type DisconnectChannelUndoSnapshot,
} from './disconnect-channel'

/**
 * Command interceptors for the Communications Hub.
 *
 * Phase 4 deliverable 5 of the email integration spec:
 *   - `beforeUndo` interceptor on `communication_channels.disconnect_channel`.
 *     If a different channel became primary while this one was disconnected,
 *     blocking the undo is the right call — restoring `is_primary=true` would
 *     violate the partial unique index `communication_channels_one_primary_per_user_uq`,
 *     and silently demoting the *other* channel would surprise the user.
 *
 * Auto-discovered by `commands/interceptors.ts` convention; no DI registration
 * required.
 */
export const interceptors: CommandInterceptor[] = [
  {
    id: 'communication_channels.disconnect-channel-before-undo',
    targetCommand: COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
    priority: 50,
    async beforeUndo(
      undoContext: CommandInterceptorUndoContext,
      ctxRuntime,
    ): Promise<CommandInterceptorBeforeResult | void> {
      const logEntry = undoContext.logEntry as
        | { result?: { undo?: unknown } | null; resultJson?: { undo?: unknown } | null; resultBody?: unknown }
        | null
      // The action-log entry stores the original result; we accept several
      // shapes so this interceptor stays decoupled from the log's exact schema.
      const candidate =
        (logEntry?.result?.undo as unknown) ??
        (logEntry?.resultJson?.undo as unknown) ??
        (logEntry?.resultBody as unknown) ??
        (undoContext as unknown as { undoPayload?: unknown }).undoPayload
      const snapshot: DisconnectChannelUndoSnapshot | null = extractUndoPayload(candidate)
      if (!snapshot) {
        // No snapshot we can interpret → let undo proceed; the command's own
        // undo() handler will no-op if the channel can't be re-resolved.
        return
      }
      // Only enforce when the disconnected channel was the primary.
      if (!snapshot.previousIsPrimary) {
        return
      }

      const em = (ctxRuntime.container.resolve('em') as EntityManager).fork()
      const ownedChannel = await findOneWithDecryption(
        em,
        CommunicationChannel,
        { id: snapshot.channelId } as any,
      )
      if (!ownedChannel) return // command's undo() will silently no-op

      const otherPrimary = await findOneWithDecryption(
        em,
        CommunicationChannel,
        {
          tenantId: ownedChannel.tenantId,
          organizationId: ownedChannel.organizationId ?? null,
          userId: ownedChannel.userId,
          isPrimary: true,
          deletedAt: null,
        } as any,
        undefined,
        {
          tenantId: ownedChannel.tenantId,
          organizationId: ownedChannel.organizationId ?? null,
        },
      )
      if (otherPrimary && otherPrimary.id !== snapshot.channelId) {
        return {
          ok: false,
          message:
            'Another channel is now primary for this user. Set it as non-primary before restoring the disconnected channel as primary.',
        }
      }
    },
  },
]

export default interceptors
