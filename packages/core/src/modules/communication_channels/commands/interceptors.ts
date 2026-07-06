import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandInterceptor,
  CommandInterceptorBeforeResult,
  CommandInterceptorUndoContext,
} from '@open-mercato/shared/lib/commands/command-interceptor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CommunicationChannel } from '../data/entities'
import {
  COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
  extractSnapshotFromLog,
  type DisconnectChannelUndoSnapshot,
} from './disconnect-channel'

/**
 * Command interceptors for the Communications Hub.
 *
 * Phase 4 deliverable 5 of the email integration spec:
 *   - `beforeUndo` interceptor on `communication_channels.channel.disconnect`.
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
      // Read the snapshot exactly as the command's own undo() handler does — from
      // the persisted action-log `commandPayload.undo` (written by buildLog). The
      // earlier `result.undo`/`resultJson`/`resultBody` shapes do not exist on the
      // ActionLog entity, so this guard previously never fired.
      const snapshot: DisconnectChannelUndoSnapshot | null = extractSnapshotFromLog(
        undoContext.logEntry,
      )
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
      // Resolve only within the snapshot's tenant — never by bare id, which
      // would cross tenant boundaries. New snapshots always carry tenantId.
      if (!snapshot.tenantId) return
      const ownedChannel = await findOneWithDecryption(
        em,
        CommunicationChannel,
        { id: snapshot.channelId, tenantId: snapshot.tenantId },
        undefined,
        { tenantId: snapshot.tenantId as string, organizationId: null },
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
        },
        undefined,
        {
          tenantId: ownedChannel.tenantId,
          organizationId: ownedChannel.organizationId ?? null,
        },
      )
      if (otherPrimary && otherPrimary.id !== snapshot.channelId) {
        // Operator-facing block reason. Localize via the request locale when
        // available, but undo can also run outside a request (queue worker / CLI)
        // where the i18n module registry is uninitialized and resolveTranslations()
        // throws — fall back to the English string rather than failing the block.
        const fallback =
          'Another channel is now primary for this user. Set it as non-primary before restoring the disconnected channel as primary.'
        let message = fallback
        try {
          const { translate } = await resolveTranslations()
          message = translate('communication_channels.errors.undoBlockedPrimaryConflict', fallback)
        } catch {
          message = fallback
        }
        return { ok: false, message }
      }
    },
  },
]

export default interceptors
