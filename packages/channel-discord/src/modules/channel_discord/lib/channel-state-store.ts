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

export type RecordAutoReplyOutcomeResult = 'written' | 'unchanged' | 'not_found'

/** Truncated so a provider stack trace cannot grow the JSONB column without bound. */
const AUTO_REPLY_ERROR_MAX_LENGTH = 500

/**
 * Record — or clear — why the last AI auto-reply attempt on this channel produced
 * nothing.
 *
 * The subscriber degrades every failure to a no-op on purpose: a broken model, a
 * denied policy check or a malformed object must never turn into a send. Being
 * *silent* about it is the part that hurts, because the operator's surface still
 * reads "Auto-reply on" while the channel answers nothing, and a `logger.warn` in
 * a background subscriber is not somewhere anyone looks. A save-time check cannot
 * close this on its own either — the settings route validates the agent against
 * the auto-reply principal, but a role edited afterwards makes that verdict stale.
 *
 * `failure: null` clears the marker, and the caller is expected to skip the write
 * when there is nothing to clear — a successful reply on a healthy channel must
 * not cost a row update per inbound message.
 *
 * The channel row's own `lastError` is deliberately left alone: the hub owns it
 * for delivery and polling failures, clears it on a successful poll, and keys the
 * reauth banner off `status`. Borrowing it here would let an AI failure mask a
 * delivery failure and let a successful poll erase an AI one.
 */
export async function recordDiscordAutoReplyOutcome(params: {
  em: EntityManager
  channelId: string
  scope: DiscordChannelScope
  failure: string | null
  now?: Date
}): Promise<RecordAutoReplyOutcomeResult> {
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

  const current = discordChannelStateSchema.parse(channel.channelState ?? {})
  const failure = params.failure?.slice(0, AUTO_REPLY_ERROR_MAX_LENGTH) ?? null
  if (failure === null && current.aiAutoReplyLastError === undefined) return 'unchanged'
  if (failure !== null && current.aiAutoReplyLastError === failure) return 'unchanged'

  const next: DiscordChannelState = { ...current }
  if (failure === null) {
    delete next.aiAutoReplyLastError
    delete next.aiAutoReplyLastErrorAt
  } else {
    next.aiAutoReplyLastError = failure
    next.aiAutoReplyLastErrorAt = (params.now ?? new Date()).toISOString()
  }

  channel.channelState = next
  await fork.flush()
  return 'written'
}

export type QuarantineDiscordChannelResult = 'quarantined' | 'not_found'

/**
 * Park a channel Discord has fatally rejected so the reconciler stops re-opening it.
 *
 * A `4004` (invalid token) or `4014` (disallowed intents) close is not
 * recoverable by retrying: the token or the Developer Portal toggle has to
 * change first. Without a persisted status the refresh job sees "no live
 * session" on the next tick and IDENTIFYs again — at the CLI's default 60s
 * refresh that is ~1440 session starts per day against Discord's ~1000/day
 * per-bot budget, while the row and the admin UI still read `connected`.
 *
 * Writing `requires_reauth` mirrors what the hub already does for a channel
 * whose credentials could not be persisted (`connect-channel.ts`), so the
 * existing reauth banner, the mutation guard that keys on `status`, and the
 * operator's reconnect flow all engage without any hub change.
 */
export async function quarantineDiscordChannel(params: {
  em: EntityManager
  channelId: string
  scope: DiscordChannelScope
  reason: string
}): Promise<QuarantineDiscordChannelResult> {
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

  channel.status = 'requires_reauth'
  channel.lastError = params.reason
  await fork.flush()
  return 'quarantined'
}
