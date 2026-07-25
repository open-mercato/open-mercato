import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload as extractSharedUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { emitCommunicationChannelsEvent } from '../events'
import { pushUnregister } from './push-unregister'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'disconnect-channel' })

const disconnectChannelSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type DisconnectChannelInput = z.infer<typeof disconnectChannelSchema>

export type DisconnectChannelResult =
  | {
      status: 'disconnected'
      channelId: string
      undo: DisconnectChannelUndoSnapshot
    }
  | { status: 'noop'; reason: string }
  | { status: 'not_owner'; reason: string }

export interface DisconnectChannelUndoSnapshot {
  channelId: string
  // Optional for backward compatibility with log entries written before tenant
  // scoping was added to the undo lookup; new snapshots always set it.
  tenantId?: string
  previousStatus: string
  previousIsActive: boolean
  previousIsPrimary: boolean
  previousCredentialsRef: string | null
  previousLastError: string | null
}

export const COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID =
  'communication_channels.channel.disconnect'

/**
 * Disconnect a per-user channel.
 *
 * Setting `status='disconnected'` halts the polling worker (slice 3b filters by
 * status) and clears the credentials reference so the adapter can't pick the
 * channel up by accident. `isPrimary` is cleared too — keeping it set would
 * leave the user without a working primary and any future `send-as-user` call
 * would 404 the lookup. The `credentials_ref` row in `integration_credentials`
 * is left orphaned; the integrations module's retention policy sweeps it.
 *
 * The command is undoable: the `before` snapshot captures the four-tuple
 * (status, is_active, is_primary, credentials_ref) so undo can restore the
 * channel atomically. Undo is gated by the `beforeUndo` interceptor in
 * `commands/interceptors.ts` — if another channel became primary while this
 * one was disconnected, undo is blocked to avoid violating the partial-unique
 * "one primary per user" constraint.
 */
const disconnectChannelCommand: CommandHandler<
  DisconnectChannelInput,
  DisconnectChannelResult
> = {
  id: COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
  // Explicitly undoable (the bus also infers this from `undo` below, but
  // declaring it keeps undoability from silently dropping under a refactor).
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = disconnectChannelSchema.parse(rawInput) as DisconnectChannelInput
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
    if (channel.status === 'disconnected' && !channel.isActive) {
      return { status: 'noop', reason: 'channel is already disconnected' }
    }

    const undo: DisconnectChannelUndoSnapshot = {
      channelId: channel.id,
      tenantId: channel.tenantId,
      previousStatus: channel.status,
      previousIsActive: channel.isActive,
      previousIsPrimary: channel.isPrimary,
      previousCredentialsRef: channel.credentialsRef ?? null,
      previousLastError: channel.lastError ?? null,
    }

    // Spec C § Phase C5 — tear down provider-side push delivery BEFORE we
    // clear `credentialsRef`. Best-effort: any failure (404, expired token,
    // adapter error) is logged inside `pushUnregister` and never re-raised.
    // The teardown needs valid credentials, which we still have at this
    // point — clearing them below would make it impossible.
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

    channel.status = 'disconnected'
    channel.isActive = false
    channel.isPrimary = false
    channel.credentialsRef = null
    channel.lastError = 'user-disconnected'
    channel.lastPolledAt = new Date()
    await em.flush()

    // Emit AFTER flush so subscribers observe a committed state. Persistent
    // delivery so workflows/audit/UI refresh can retry on failure.
    await emitCommunicationChannelsEvent(
      'communication_channels.channel.disconnected',
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

    return { status: 'disconnected', channelId: channel.id, undo }
  },
  // Persist the undo snapshot into the action log. Without this, the command bus
  // mints an undo token (so the UI offers "Undo") but the snapshot returned from
  // execute() is never stored, and undo() would silently no-op.
  async buildLog({ input, result }) {
    if (result.status !== 'disconnected') return null
    return {
      resourceKind: 'communication_channels.channel',
      resourceId: result.channelId,
      tenantId: result.undo.tenantId ?? input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
      payload: { undo: result.undo },
      snapshotBefore: result.undo,
    }
  },
  async undo({ ctx, logEntry }) {
    const snapshot = extractSnapshotFromLog(logEntry)
    if (!snapshot) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // Never resolve by bare id (cross-tenant). New snapshots always carry
    // tenantId; refuse the undo if a legacy snapshot lacks it.
    if (!snapshot.tenantId) return
    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      { id: snapshot.channelId, tenantId: snapshot.tenantId },
      undefined,
      { tenantId: snapshot.tenantId, organizationId: null },
    )
    if (!channel) return

    channel.status = snapshot.previousStatus as CommunicationChannel['status']
    channel.isActive = snapshot.previousIsActive
    channel.isPrimary = snapshot.previousIsPrimary
    channel.credentialsRef = snapshot.previousCredentialsRef
    channel.lastError = snapshot.previousLastError
    await em.flush()
  },
}

/**
 * Read the undo payload defensively — wraps the shared
 * `@open-mercato/shared/lib/commands/undo.ts` helper with a narrow-by-shape
 * validation so callers get a strongly-typed snapshot or `null`.
 *
 * Kept as a separate export for test ergonomics (tests can mock the snapshot
 * shape directly without round-tripping through a CommandLogEntry).
 */
export function extractUndoPayload(value: unknown): DisconnectChannelUndoSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { undo?: unknown; channelId?: unknown }).undo ?? value
  if (!candidate || typeof candidate !== 'object') return null
  const obj = candidate as Record<string, unknown>
  if (typeof obj.channelId !== 'string') return null
  return {
    channelId: obj.channelId,
    tenantId: typeof obj.tenantId === 'string' ? obj.tenantId : undefined,
    previousStatus: typeof obj.previousStatus === 'string' ? obj.previousStatus : 'connected',
    previousIsActive: typeof obj.previousIsActive === 'boolean' ? obj.previousIsActive : true,
    previousIsPrimary: typeof obj.previousIsPrimary === 'boolean' ? obj.previousIsPrimary : false,
    previousCredentialsRef:
      typeof obj.previousCredentialsRef === 'string' ? obj.previousCredentialsRef : null,
    previousLastError: typeof obj.previousLastError === 'string' ? obj.previousLastError : null,
  }
}

/**
 * Pulls the disconnect snapshot from a command log entry — first via the
 * shared `extractUndoPayload` helper, then through the local shape-validator.
 * Always falls back to `null` so the undo handler can no-op safely.
 */
export function extractSnapshotFromLog(logEntry: unknown): DisconnectChannelUndoSnapshot | null {
  const undo = extractSharedUndoPayload<DisconnectChannelUndoSnapshot>(
    (logEntry ?? null) as never,
  )
  if (undo) return extractUndoPayload(undo)
  return extractUndoPayload(logEntry)
}

registerCommand(disconnectChannelCommand)

export default disconnectChannelCommand
