import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload as extractSharedUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { channelOrgScopeWhere } from '../lib/access-control'
import { pushUnregister } from './push-unregister'
import { emitCommunicationChannelsEvent } from '../events'

const logger = createLogger('communication_channels')

const adminDeleteChannelSchema = z.object({
  channelId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type AdminDeleteChannelInput = z.infer<typeof adminDeleteChannelSchema>

export type AdminDeleteChannelResult =
  | { status: 'deleted'; channelId: string; undo: AdminDeleteChannelUndoSnapshot }
  | { status: 'noop'; reason: string }
  | { status: 'not_tenant_wide'; reason: string }

export interface AdminDeleteChannelUndoSnapshot {
  channelId: string
  // Optional only for back-compat with any pre-existing log entries; new
  // snapshots always set it so the undo lookup stays tenant-scoped.
  tenantId?: string
}

export const COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID =
  'communication_channels.channel.admin_delete'

/**
 * Admin soft-delete for a TENANT-WIDE channel (`user_id IS NULL`) — the
 * companion to `delete-channel.ts` (owner-only, per-user path). Tenant-wide
 * channels (shared inboxes and the push providers FCM/APNs/Expo) have no owner,
 * so the owner path rejects them as `not_owner`; this path deletes them under
 * the `communication_channels.admin` feature.
 *
 * The channel is loaded org-agnostically (tenant-wide push channels store
 * `organization_id IS NULL`, but shared inboxes may pin an org) via
 * `channelOrgScopeWhere`, so it resolves from any session org in the tenant.
 * Per-user channels are refused with `not_tenant_wide` — they MUST go through
 * the owner path so personal-mailbox privacy holds.
 *
 * Provider-side push delivery is torn down best-effort BEFORE the soft-delete,
 * keyed on the CHANNEL's own org (`channel.organizationId ?? tenantId`) so
 * credentials resolve where they were written (see push-register.ts /
 * connect-credential-channel.ts). Mirrors `delete-channel`'s teardown.
 *
 * Undoable: undo clears `deleted_at` to restore the row. Parity with
 * `delete-channel` — same event, payload, buildLog, and undo shape.
 */
const adminDeleteChannelCommand: CommandHandler<
  AdminDeleteChannelInput,
  AdminDeleteChannelResult
> = {
  id: COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID,
  // Explicitly undoable (the bus also infers this from `undo` below, but
  // declaring it keeps undoability from silently dropping under a refactor).
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = adminDeleteChannelSchema.parse(rawInput) as AdminDeleteChannelInput
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
        ...channelOrgScopeWhere(input.scope.organizationId),
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    if (!channel) {
      return { status: 'noop', reason: 'channel not found' }
    }
    if (channel.userId != null) {
      return {
        status: 'not_tenant_wide',
        reason: 'channel is a per-user channel; use the owner delete path',
      }
    }

    // Tear down provider-side push delivery before the soft-delete, while
    // credentials are still resolvable. Keyed on the channel's OWN org (push
    // channels store credentials at `organization_id = tenantId`; shared inboxes
    // at their pinned org). Best-effort — failures are logged inside
    // pushUnregister and never re-raised.
    if (channel.credentialsRef) {
      const channelOrganizationId = channel.organizationId ?? input.scope.tenantId
      try {
        await pushUnregister({
          container: ctx.container,
          scope: {
            tenantId: input.scope.tenantId,
            organizationId: channelOrganizationId,
            userId: channel.userId ?? null,
          },
          input: { channelId: channel.id },
        })
      } catch (err) {
        logger.warn('admin-delete-channel push unregister failed', { channelId: channel.id, err })
      }
    }

    channel.deletedAt = new Date()
    channel.isPrimary = false
    await em.flush()

    // Emit AFTER flush so subscribers observe the committed soft-delete. Same
    // event/payload shape as delete-channel so workflows/audit observe the full
    // channel lifecycle. Persistent so the delivery can retry on failure.
    await emitCommunicationChannelsEvent(
      'communication_channels.channel.deleted',
      {
        channelId: channel.id,
        userId: channel.userId ?? null,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        tenantId: input.scope.tenantId,
        organizationId: channel.organizationId ?? null,
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
 * `delete-channel.ts` so tests can construct snapshots directly.
 */
export function extractUndoPayload(value: unknown): AdminDeleteChannelUndoSnapshot | null {
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

function extractSnapshotFromLog(logEntry: unknown): AdminDeleteChannelUndoSnapshot | null {
  const undo = extractSharedUndoPayload<AdminDeleteChannelUndoSnapshot>((logEntry ?? null) as never)
  if (undo) return extractUndoPayload(undo)
  return extractUndoPayload(logEntry)
}

registerCommand(adminDeleteChannelCommand)

export default adminDeleteChannelCommand
