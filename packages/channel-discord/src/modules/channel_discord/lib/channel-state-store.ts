import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { discordChannelStateSchema, type DiscordChannelState } from './credentials'

/**
 * Tenant/organization scope every Discord channel-state write MUST carry.
 * The gateway worker persists resume state from a WebSocket callback that fires
 * long after the job handler returned, so the scope is captured up front from
 * the channel row the job loaded and replayed on every write.
 */
export type DiscordChannelScope = {
  tenantId: string
  organizationId: string | null
}

/** The gateway-owned subset of `channelState` this store is allowed to write. */
export type DiscordChannelStatePatch = {
  sessionId?: string
  sequence?: number | null
  resumeGatewayUrl?: string
  botUserId?: string
}

export type PersistDiscordChannelStateResult = 'written' | 'skipped' | 'not_found'

/**
 * Merge a gateway resume-state patch onto the state currently stored on the
 * channel row, or return `null` when the patch must not be written.
 *
 * Two rules make this safe against the socket callbacks racing each other:
 *
 * - Only the gateway-owned keys are touched; every other key (`aiAutoReplyEnabled`,
 *   `aiAgentId`, operator-set fields) is carried forward from the row that was
 *   just read, so a concurrent UI edit is never clobbered wholesale.
 * - A patch that would rewind the sequence of the session already stored is
 *   dropped. A late `READY` callback from a superseded socket must not overwrite
 *   fresher resume state with a stale cursor.
 */
export function mergeDiscordChannelState(
  currentRaw: unknown,
  patch: DiscordChannelStatePatch,
  now: Date,
): DiscordChannelState | null {
  const current = discordChannelStateSchema.parse(currentRaw ?? {})
  const sameSession = Boolean(patch.sessionId) && patch.sessionId === current.sessionId
  const rewindsSequence =
    sameSession &&
    typeof patch.sequence === 'number' &&
    typeof current.sequence === 'number' &&
    patch.sequence < current.sequence
  if (rewindsSequence) return null

  return {
    ...current,
    ...patch,
    lastConnectedAt: now.toISOString(),
  }
}

/**
 * Scoped read-modify-write of a Discord channel's gateway resume state.
 *
 * The lookup filters by `tenant_id` / `organization_id` (never by id alone) so a
 * socket callback can only ever touch the row its own channel scope owns, and it
 * runs on its own `EntityManager` fork so the flush never rides on the request
 * context the worker job was started from.
 */
export async function persistDiscordChannelState(params: {
  em: EntityManager
  channelId: string
  scope: DiscordChannelScope
  patch: DiscordChannelStatePatch
  now?: Date
}): Promise<PersistDiscordChannelStateResult> {
  const fork = params.em.fork()
  const channel = await findOneWithDecryption(
    fork,
    CommunicationChannel,
    {
      id: params.channelId,
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId,
      deletedAt: null,
    },
    undefined,
    {
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId ?? params.scope.tenantId,
    },
  )
  if (!channel) return 'not_found'

  const merged = mergeDiscordChannelState(channel.channelState, params.patch, params.now ?? new Date())
  if (!merged) return 'skipped'

  channel.channelState = merged
  await fork.flush()
  return 'written'
}
