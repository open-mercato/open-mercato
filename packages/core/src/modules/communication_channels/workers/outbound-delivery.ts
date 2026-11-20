import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
  type DeliverOutboundMessageInput,
  type DeliverOutboundMessageResult,
} from '../commands/deliver-outbound-message'
import { computeBackoffMs } from '../lib/error-classification'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'outbound-delivery' })

/**
 * Worker payload — the subscriber enqueues `{ messageId, scope, attempt? }`.
 *
 * `attempt` starts at 1 on first enqueue. The worker increments it when
 * re-enqueueing for retry, until `MAX_ATTEMPTS` is reached.
 */
export type OutboundDeliveryPayload = {
  messageId: string
  scope: {
    tenantId: string
    organizationId: string | null
  }
  /** Attempt number, 1-based. Set by the subscriber for the first try; the worker increments on retry. */
  attempt?: number
  /** Force credential refresh on this attempt — used after a 401 from the provider. */
  forceCredentialRefresh?: boolean
  /** Participant of a "send separately" link; omitted for the joint link. */
  externalParticipantId?: string | null
}

export const OUTBOUND_DELIVERY_MAX_ATTEMPTS = 3

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.outbound,
  id: 'communication_channels:outbound-delivery',
  concurrency: 10,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Outbound delivery worker.
 *
 * Dispatches the `deliver_outbound_message` command which performs the actual
 * send. The command returns a classified result:
 *   - `delivered` / `already_delivered` / `no_channel_link` / `not_due` → return.
 *   - `failed` with `requiresReauth` and no forced refresh yet → one immediate
 *      retry with a forced credential refresh.
 *   - `failed` with `participantDelivery` → the participants own the schedule:
 *      re-enqueue at their `nextAttemptAt` (the command used this worker's short
 *      backoff for the first attempts, then the configured retry delay, until
 *      the delivery window closes), or stop when none is pending.
 *   - legacy links without participants: `transient: true` → exponential backoff
 *      up to `OUTBOUND_DELIVERY_MAX_ATTEMPTS`; `transient: false` → stop.
 *
 * The command already wrote the failure record + emitted `.delivery_failed`,
 * so the worker just decides whether to schedule another attempt.
 *
 * We DO NOT throw on a recorded delivery-failure outcome — that would let the
 * queue apply its own retry policy on top of ours, double-retrying. Explicit
 * re-enqueue with delayMs is the portable, controllable pattern. The one
 * exception is an *unexpected* exception from the command itself (e.g. a DB blip
 * that stopped it from recording anything): we re-enqueue up to our max and then
 * rethrow so the infrastructure failure surfaces to the queue's dead-letter
 * instead of vanishing. The command's idempotency prevents a double-send.
 */
export default async function handle(
  job: QueuedJob<OutboundDeliveryPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const { messageId, scope, attempt = 1, forceCredentialRefresh, externalParticipantId } = job.payload

  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const containerProxy = { resolve: ctx.resolve.bind(ctx) }
  const commandCtx = {
    container: containerProxy as never,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId ?? null,
    organizationIds: scope.organizationId ? [scope.organizationId] : null,
  }

  let outcome: DeliverOutboundMessageResult
  try {
    const { result } = await commandBus.execute<
      DeliverOutboundMessageInput,
      DeliverOutboundMessageResult
    >(
      COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
      {
        input: {
          messageId,
          scope,
          forceCredentialRefresh,
          externalParticipantId,
          ...(attempt < OUTBOUND_DELIVERY_MAX_ATTEMPTS ? { transientRetryDelayMs: computeBackoffMs(attempt) } : {}),
        },
        ctx: commandCtx as never,
      },
    )
    outcome = result
  } catch (err) {
    // Unexpected error inside the command itself (e.g. DB blip). Re-enqueue
    // up to MAX_ATTEMPTS so we don't lose deliveries due to infrastructure flakes.
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.warn('command threw during delivery attempt', { attempt, messageId, reason: errorMessage })
    if (attempt < OUTBOUND_DELIVERY_MAX_ATTEMPTS) {
      await reenqueue(job.payload, attempt)
      return
    }
    // Attempts exhausted on an unexpected command exception — rethrow so the
    // failure reaches the queue's dead-letter / observability (see header note).
    throw err
  }

  switch (outcome.status) {
    case 'delivered':
    case 'already_delivered':
    case 'no_channel_link':
    case 'not_due':
      return
    case 'failed': {
      // Reauth (401 / invalid_grant): the command already flipped the channel to
      // `requires_reauth`. Give the credentials exactly one forced-refresh retry
      // before giving up — a near-expiry access token whose proactive refresh
      // was skipped can still recover here. If we already forced a refresh and
      // still got a reauth error, the token is unrecoverable: stop (the operator
      // must reconnect).
      // The forced flag rides on every later attempt, so this branch runs once.
      if (outcome.requiresReauth && !forceCredentialRefresh) {
        logger.warn('reauth failure; retrying once with a forced credential refresh', { attempt, messageId, providerKey: outcome.providerKey, reason: outcome.error })
        await reenqueue({ ...job.payload, forceCredentialRefresh: true }, attempt)
        return
      }
      if (outcome.participantDelivery) {
        const nextAttemptAt = outcome.participantDelivery.nextAttemptAt
        if (nextAttemptAt) {
          logger.warn('delivery failure; participants retry later', { attempt, messageId, providerKey: outcome.providerKey, nextAttemptAt, reason: outcome.error })
          // A second of slack so the job never lands before the participant claim is due.
          await reenqueue(job.payload, attempt, Math.max(0, Date.parse(nextAttemptAt) - Date.now()) + 1000)
          return
        }
        logger.error('giving up on message delivery', { messageId, attempt, providerKey: outcome.providerKey, reason: outcome.error })
        return
      }
      if (outcome.transient && attempt < OUTBOUND_DELIVERY_MAX_ATTEMPTS) {
        logger.warn('transient delivery failure; re-enqueueing', { attempt, messageId, providerKey: outcome.providerKey, reason: outcome.error })
        await reenqueue(job.payload, attempt)
        return
      }
      // Permanent or attempts exhausted — `.delivery_failed` was already emitted
      // by the command, so we stop here.
      logger.error('giving up on message delivery', { messageId, attempt, providerKey: outcome.providerKey, reason: outcome.error })
      return
    }
  }
}

async function reenqueue(payload: OutboundDeliveryPayload, attempt: number, delayMs: number = computeBackoffMs(attempt)): Promise<void> {
  const next: OutboundDeliveryPayload = {
    ...payload,
    attempt: attempt + 1,
  }
  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.outbound)
  await queue.enqueue(next as unknown as Record<string, unknown>, { delayMs })
}
